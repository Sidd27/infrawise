import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type {
  SystemGraph,
  Finding,
  GraphEdge,
  AnalysisProvenance,
  InfrawiseConfig,
} from '../types.js';
import { logger } from '../core/index.js';

const { version } = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
) as { version: string };
import {
  summarizeFindings,
  lambdaCostSignal,
  dynamoCostSignal,
  cacheCostSignal,
} from '../analyzers/index.js';
import {
  getTableNodes,
  getFunctionNodes,
  getQueueNodes,
  getTopicNodes,
  getSecretNodes,
  getParameterNodes,
  getLogGroupNodes,
  getLambdaNodes,
  getEventBridgeRuleNodes,
  getBucketNodes,
  getAPINodes,
  getStackOutputNodes,
  getUserPoolNodes,
  getStreamNodes,
  getKafkaClusterNodes,
  getCacheClusterNodes,
  getDistributionNodes,
  getScanEdges,
  getOutgoingEdges,
} from '../graph/index.js';

// ── State ────────────────────────────────────────────────────────────────────

let currentGraph: SystemGraph = { nodes: [], edges: [] };
let currentFindings: Finding[] = [];
// When the loaded analysis was produced (ms epoch). null when serving an empty
// graph with no analysis. Surfaced via get_infra_overview so assistants can
// judge how stale the facts are and decide to refresh.
let analyzedAt: number | null = null;
// Config the responses depend on. `suggestRefreshAfterMs` is the one verdict
// infrawise still renders: `ageSeconds` is the fact the caller decides on, this
// is a coarse backstop for when it does not, defaulting well below the 24h cache
// TTL because a working day is long enough for infrastructure to move underneath
// a session. `logWindowHours` is the window the log adapter actually scanned —
// reporting a fixed 24 would state a window nobody used.
//
// Assigned together from one config so a value can never be left over from a
// previous load, and so the next config key does not add a third setter.
const DEFAULT_SUGGEST_REFRESH_HOURS = 6;
const DEFAULT_LOG_WINDOW_HOURS = 24;
let suggestRefreshAfterMs = DEFAULT_SUGGEST_REFRESH_HOURS * 60 * 60 * 1000;
let logWindowHours = DEFAULT_LOG_WINDOW_HOURS;
// False when the server booted without an infrawise.yaml (e.g. a hosted MCP
// runtime). Used to return a "run locally" hint instead of a bare empty graph.
let configured = true;

// Per-source extraction outcomes for the loaded analysis. Empty when the
// analysis predates provenance tracking, which is treated as "no claim" rather
// than "everything succeeded" — an old cache must not assert completeness.
let provenance: AnalysisProvenance | null = null;

// Freshness comes from provenance and nowhere else: provenance records when the
// cloud was actually read. Any other timestamp available here — when this graph
// object was assembled, when the cache file was written — describes a rebuild,
// and a code-only rebuild re-reads no infrastructure at all. Deriving rather
// than accepting a value makes "fresh graph, stale facts" unrepresentable.
export function setGraphState(
  graph: SystemGraph,
  findings: Finding[],
  sourceProvenance: AnalysisProvenance | null = null,
): void {
  currentGraph = graph;
  currentFindings = findings;
  provenance = sourceProvenance;
  analyzedAt = sourceProvenance?.analyzedAt ?? null;
}

// How the server picks up an analysis written after it booted. Set by the CLI
// bootstrap, which owns cache knowledge; returns null when nothing has changed.
// Pull on access rather than a filesystem watcher: no debounce, no missed
// events, no platform caveats, and no way for the watcher to die unnoticed.
let reload: (() => { graph: SystemGraph; findings: Finding[] } | null) | null = null;

export function setSnapshotLoader(fn: typeof reload): void {
  reload = fn;
}

// ── Data health ──────────────────────────────────────────────────────────────
//
// One fixed-shape block on every response. Every key is always present and state
// lives in values, never in whether a key exists: a consumer that has to branch
// on presence reads "absent" as "fine", which is the failure this whole thing
// exists to prevent. `error` and `reason` are null rather than omitted.

const NO_PROVENANCE = 'analysis predates source tracking — re-run `infrawise analyze`';

// Sources this tool's answer rests on. Scoped per tool so the block stays
// bounded, fixed per tool so the shape stays stable. Tools with no gating
// service (get_infra_overview, get_graph_summary) speak for the whole graph and
// list everything.
function sourcesFor(tool: { name: string; service?: string; sources?: string[] } | undefined) {
  if (!provenance) return [];
  const graphWide = tool === undefined || (!tool.service && !tool.sources);
  const wanted = graphWide ? null : [tool.service, ...(tool.sources ?? [])].filter(Boolean);
  return provenance.sources
    .filter((s) => wanted === null || wanted.includes(s.service))
    .map((s) => ({ service: s.service, status: s.status, error: s.error ?? null }));
}

// Has `cdk synth` run since the analysis? The two existing checks in the IaC
// adapter compare cdk.out against itself, so a synth that rewrites every
// template leaves them all mutually consistent and both checks silent while the
// served graph was built from the previous one. This compares disk to the
// snapshot instead.
//
// mtime also moves on `git checkout`, so a branch switch can read as a synth. A
// false "changed" costs one analyze; a false "unchanged" costs code written
// against infrastructure that moved.
function iacHealth() {
  const unknown = (reason: string) => ({
    status: 'unknown' as const,
    synthedAt: null,
    analyzedAt: analyzedAt === null ? null : new Date(analyzedAt).toISOString(),
    reason,
  });
  if (!provenance) return unknown(NO_PROVENANCE);
  if (!provenance.cdkOutDir) return unknown('no cdk.out directory recorded for this project');
  if (analyzedAt === null) return unknown('no analysis loaded');

  let newest = 0;
  try {
    const entries = readdirSync(provenance.cdkOutDir).filter((f) => f.endsWith('.template.json'));
    if (entries.length === 0) return unknown('no CDK templates found in cdk.out');
    for (const entry of entries) {
      newest = Math.max(newest, statSync(join(provenance.cdkOutDir, entry)).mtimeMs);
    }
  } catch {
    return unknown('cdk.out is not readable from the server');
  }

  return {
    status: newest > analyzedAt ? ('changed' as const) : ('unchanged' as const),
    synthedAt: new Date(newest).toISOString(),
    analyzedAt: new Date(analyzedAt).toISOString(),
    reason: null,
  };
}

// Node-level source attribution for get_graph_summary. Derived from the node's
// own shape rather than stamped at build time, so no node schema changes. Every
// node carries `source` and `sourceStatus` — a node from a healthy source says
// so explicitly instead of being silent, for the same reason the envelope does.
const NODE_SOURCE: Record<string, string> = {
  queue: 'sqs',
  topic: 'sns',
  secret: 'secretsManager',
  parameter: 'ssm',
  lambda: 'lambda',
  eventbridge_rule: 'eventbridge',
  bucket: 's3',
  api: 'apiGateway',
  log_group: 'cloudwatchLogs',
  user_pool: 'cognito',
  stream: 'kinesis',
  kafka_cluster: 'msk',
  cache_cluster: 'elasticache',
  distribution: 'cloudfront',
  database_instance: 'rds',
};

function withNodeSource(nodes: SystemGraph['nodes']) {
  return nodes.map((n) => {
    const service = n.type === 'table' ? n.databaseType : NODE_SOURCE[n.type];
    const state = service ? provenance?.sources.find((s) => s.service === service) : undefined;
    return {
      ...n,
      source: service ?? null,
      sourceStatus: state?.status ?? 'unknown',
    };
  });
}

function dataHealth(
  tool: { name: string; service?: string; sources?: string[] } | undefined,
  maxAgeSeconds: unknown,
) {
  const ageSeconds = analyzedAt === null ? null : Math.round((Date.now() - analyzedAt) / 1000);
  const requested = typeof maxAgeSeconds === 'number' ? maxAgeSeconds : null;
  return {
    dataHealth: {
      analyzedAt: analyzedAt === null ? null : new Date(analyzedAt).toISOString(),
      ageSeconds,
      // Never claim freshness we cannot vouch for: with no analysis loaded this
      // stays true rather than defaulting to "no need".
      suggestRefresh: analyzedAt === null ? true : Date.now() - analyzedAt > suggestRefreshAfterMs,
      refreshWith: 'infrawise analyze',
      requestedMaxAgeSeconds: requested,
      withinRequestedAge:
        requested === null || ageSeconds === null ? null : ageSeconds <= requested,
      region: provenance?.region ?? null,
      profile: provenance?.profile ?? null,
      sources: sourcesFor(tool),
      iac: iacHealth(),
    },
  };
}

export function setServerConfig(config: InfrawiseConfig | undefined): void {
  configured = config !== undefined;
  suggestRefreshAfterMs =
    (config?.freshness?.suggestRefreshAfterHours ?? DEFAULT_SUGGEST_REFRESH_HOURS) * 60 * 60 * 1000;
  logWindowHours = config?.cloudwatchLogs?.windowHours ?? DEFAULT_LOG_WINDOW_HOURS;
}

const NOT_CONFIGURED_HINT =
  'No infrastructure loaded. infrawise reads your live infra locally — run `npx infrawise start` in your project (with AWS credentials and an infrawise.yaml) so these tools return your real DynamoDB/RDS/SQS/Lambda/etc. context. A remotely hosted instance has no access to your cloud account or code, so it returns empty results by design.';

// ── Helpers ──────────────────────────────────────────────────────────────────

function toText(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

// Wraps every tool handler. Attaching dataHealth here, once, is what stops a
// tool added later from forgetting it: there is no per-tool opt-in to miss.
// TOOLS maps each tool to the sources its answer rests on.
function logged<T extends Record<string, unknown>>(
  name: string,
  fn: (args: T) => Promise<ReturnType<typeof toText>>,
) {
  return async (args: T) => {
    const hasArgs = Object.keys(args).length > 0;
    logger.info(`→ ${name}${hasArgs ? `  ${JSON.stringify(args)}` : ''}`);
    // Before the handler reads the graph, not after: an analysis that landed
    // since the last call must be visible to this one, or "I re-ran analyze and
    // nothing changed" is back.
    reload?.();
    const result = await fn(args);
    const payload = JSON.parse(result.content[0].text) as object;
    return toText({
      ...dataHealth(
        TOOLS.find((t) => t.name === name),
        args.maxAgeSeconds,
      ),
      ...payload,
    });
  };
}

// Every tool this server registers, with the config key that gates it (if any).
// Single source for the server card and the CLI's startup box — keep in step
// with the registerTool calls below.
export const TOOLS: ReadonlyArray<{ name: string; service?: string; sources?: string[] }> = [
  { name: 'get_infra_overview' },
  { name: 'get_graph_summary' },
  { name: 'get_table_schema', sources: ['dynamodb', 'postgres', 'mysql', 'mongodb'] },
  { name: 'analyze_function' },
  { name: 'suggest_gsi', service: 'dynamodb' },
  { name: 'postgres_index_suggestions', service: 'postgres' },
  { name: 'suggest_mongo_index', service: 'mongodb' },
  { name: 'mysql_index_suggestions', service: 'mysql' },
  { name: 'get_queue_details', service: 'sqs' },
  { name: 'get_topic_details', service: 'sns' },
  { name: 'get_secrets_overview', service: 'secretsManager' },
  { name: 'get_parameter_overview', service: 'ssm' },
  { name: 'get_lambda_overview', service: 'lambda' },
  { name: 'get_eventbridge_details', service: 'eventbridge' },
  { name: 'get_s3_overview', service: 's3' },
  { name: 'get_api_routes', service: 'apiGateway' },
  { name: 'get_log_errors', service: 'cloudwatchLogs' },
  { name: 'get_stack_outputs', service: 'terraform' },
  { name: 'get_cognito_overview', service: 'cognito' },
  { name: 'get_stream_details', service: 'kinesis', sources: ['msk'] },
  { name: 'get_cache_overview', service: 'elasticache' },
  { name: 'get_cloudfront_overview', service: 'cloudfront' },
];

// Every tool takes the same optional freshness tolerance. One definition, so the
// wording cannot drift between tools.
const maxAgeSeconds = z
  .number()
  .optional()
  .describe(
    'Freshness tolerance in seconds. Advisory: the answer is returned either way, with dataHealth.withinRequestedAge reporting whether it met the tolerance. Nothing re-reads AWS on a tool call — run `infrawise analyze` to refresh. Pass a small value for point-in-time questions ("does this queue have a DLQ right now"); omit it for architecture questions where a day-old snapshot is fine.',
  );

// ── MCP Server ────────────────────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'infrawise', version });

  mcp.registerTool(
    'get_infra_overview',
    {
      description:
        'Returns a compact infrastructure snapshot: service counts, all databases, queues, topics, secrets, lambdas, and high-severity findings. Call this first at the start of any database or infrastructure task to understand what services are in scope. Prefer this over get_graph_summary for quick orientation; use get_graph_summary only when you need every node, edge, and finding in full. Also returns a `configured` flag — when false, the server has no infrawise.yaml loaded (e.g. a remotely hosted instance) and all tools return empty results; a `setupHint` explains how to run infrawise locally. Every response (this one included) carries a `dataHealth` block with a fixed shape: `analyzedAt`/`ageSeconds` for when the infrastructure was read, per-source `status`, `iac` for whether cdk.out was synthed since, and `refreshWith`. On this tool `dataHealth.sources` covers every source rather than one tool\'s. A source that is not `ok` means an empty result is "not read", not "none exist".',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_infra_overview', async () => {
      const tables = getTableNodes(currentGraph);
      const queues = getQueueNodes(currentGraph);
      const topics = getTopicNodes(currentGraph);
      const secrets = getSecretNodes(currentGraph);
      const parameters = getParameterNodes(currentGraph);
      const logGroups = getLogGroupNodes(currentGraph);
      const lambdas = getLambdaNodes(currentGraph);
      const functions = getFunctionNodes(currentGraph);
      const buckets = getBucketNodes(currentGraph);
      const userPools = getUserPoolNodes(currentGraph);
      return toText({
        configured,
        ...(configured ? {} : { setupHint: NOT_CONFIGURED_HINT }),
        summary: {
          tables: tables.length,
          functions: functions.length,
          queues: queues.length,
          topics: topics.length,
          secrets: secrets.length,
          parameters: parameters.length,
          logGroups: logGroups.length,
          lambdas: lambdas.length,
          buckets: buckets.length,
          userPools: userPools.length,
          streams: getStreamNodes(currentGraph).length,
          cacheClusters: getCacheClusterNodes(currentGraph).length,
          distributions: getDistributionNodes(currentGraph).length,
          totalNodes: currentGraph.nodes.length,
          totalEdges: currentGraph.edges.length,
          findings: summarizeFindings(currentFindings),
        },
        databases: tables.map((t) => ({ name: t.name, type: t.databaseType })),
        queues: queues.map((q) => ({
          name: q.name,
          hasDLQ: q.hasDLQ,
          encrypted: q.encrypted,
          approximateMessages: q.approximateMessages,
        })),
        topics: topics.map((t) => ({ name: t.name, subscriptions: t.subscriptionCount })),
        secrets: secrets.map((s) => ({ name: s.name, rotationEnabled: s.rotationEnabled })),
        parameters: parameters.map((p) => ({ name: p.name, type: p.paramType, tier: p.tier })),
        lambdas: lambdas.map((l) => ({ name: l.name, runtime: l.runtime, memoryMB: l.memoryMB })),
        logGroups: logGroups.map((lg) => ({
          name: lg.name,
          retentionDays: lg.retentionDays ?? 'never',
          errorCount: lg.errorCount,
        })),
        buckets: buckets.map((b) => ({
          name: b.name,
          versioned: b.versioned,
          publicAccessBlocked: b.publicAccessBlocked,
        })),
        highFindings: currentFindings
          .filter((f) => f.severity === 'high')
          .map((f) => ({ issue: f.issue, recommendation: f.recommendation })),
      });
    }),
  );

  mcp.registerTool(
    'get_graph_summary',
    {
      description:
        'Returns every node (tables, functions, lambdas, queues, etc.), every edge (query, scan, triggers, publishes_to), and all findings. Use this when you need to trace relationships across multiple services or require the complete finding set — not just high-severity ones. For a quick overview use get_infra_overview instead.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_graph_summary', async () =>
      toText({
        nodes: withNodeSource(currentGraph.nodes),
        edges: currentGraph.edges,
        findings: currentFindings,
        summary: {
          totalNodes: currentGraph.nodes.length,
          totalEdges: currentGraph.edges.length,
          tables: getTableNodes(currentGraph).length,
          functions: getFunctionNodes(currentGraph).length,
          queues: getQueueNodes(currentGraph).length,
          scans: getScanEdges(currentGraph).length,
          ...summarizeFindings(currentFindings),
        },
      }),
    ),
  );

  mcp.registerTool(
    'analyze_function',
    {
      description:
        'Analyzes a single named function or Lambda handler for infrastructure issues: which tables it queries, how it queries them (scan vs query), queue publishing, secret access, and the correct event shape for each trigger (SQS, DynamoDB Streams, Kinesis, EventBridge). Call this before writing or reviewing a Lambda handler to get the exact trigger event shape and all findings scoped to this function. Per-file detail (file, accesses, missingPermissions) is returned in `matches`, one entry per source file defining a function with this name; `ambiguous: true` means the name matched several files, so pick the entry whose file you are actually editing instead of assuming the first. Returns found: false if the function name was not discovered during analysis.',
      inputSchema: z.object({
        function: z.string().describe('Function name to analyze'),
        maxAgeSeconds,
      }),
    },
    logged('analyze_function', async ({ function: functionName }) => {
      // Function node ids are file-scoped, so one name can match several files.
      // Returning every candidate keeps a same-named shadow definition from
      // silently standing in for the real one.
      const funcNodes = currentGraph.nodes.filter(
        (n) => n.type === 'function' && n.name === functionName,
      );

      // Also check if there's a Lambda node with this name (for AWS-deployed functions)
      const byName = currentGraph.nodes.find((n) => n.type === 'lambda' && n.name === functionName);

      // Deployed names are usually stack-prefixed, so an exact match fails for
      // most real accounts. The linkers already resolved which Lambda this
      // source function implements; follow that before giving up on triggers.
      //
      // Several Lambdas can share one handler path (`index.handler` across a
      // stack is the common case), so more than one can link to the same source
      // function. Picking the first would attach one Lambda's triggers to code
      // shared by all of them — the candidates are named instead.
      const linkEdges = byName
        ? []
        : currentGraph.edges.filter(
            (e) => e.type === 'implemented_by' && funcNodes.some((f) => f.id === e.to),
          );
      const lambdaNameOf = (id: string) => {
        const n = currentGraph.nodes.find((x) => x.id === id);
        return n && 'name' in n ? n.name : id;
      };
      const linkEdge = linkEdges.length === 1 ? linkEdges[0] : undefined;
      const lambdaNode =
        byName ?? (linkEdge ? currentGraph.nodes.find((n) => n.id === linkEdge.from) : undefined);
      const resolvedVia =
        linkEdge && linkEdge.type === 'implemented_by'
          ? { lambda: lambdaNameOf(linkEdge.from), confidence: linkEdge.confidence }
          : undefined;
      const ambiguousLambdas =
        linkEdges.length > 1
          ? linkEdges.map((e) => ({
              lambda: lambdaNameOf(e.from),
              confidence: e.type === 'implemented_by' ? e.confidence : 'inferred',
            }))
          : undefined;

      if (funcNodes.length === 0 && !lambdaNode) {
        return toText({
          function: functionName,
          found: false,
          issues: [],
          recommendations: [`Function "${functionName}" not found in the analyzed codebase.`],
        });
      }

      const nodeMap = new Map(currentGraph.nodes.map((n) => [n.id, n]));
      const relatedFindings = currentFindings.filter((f) => {
        const meta = f.metadata as Record<string, unknown> | undefined;
        return (
          meta?.functionName === functionName ||
          String(meta?.callerFunctions ?? '').includes(functionName)
        );
      });

      const allTriggers = lambdaNode?.type === 'lambda' ? (lambdaNode.triggers ?? []) : [];

      // Compute missing IAM permissions inline from graph data
      const allowedServices =
        lambdaNode?.type === 'lambda' ? lambdaNode.allowedServices : undefined;
      const missingFor = (edges: GraphEdge[]): string[] | undefined => {
        if (!allowedServices || allowedServices.includes('*')) return undefined;
        const needed = new Set<string>();
        for (const edge of edges) {
          const target = nodeMap.get(edge.to);
          if (!target) continue;
          if (
            (edge.type === 'query' || edge.type === 'scan') &&
            target.type === 'table' &&
            target.databaseType === 'dynamodb'
          )
            needed.add('dynamodb');
          else if (edge.type === 'reads_secret') needed.add('secretsmanager');
          else if (edge.type === 'reads_parameter') needed.add('ssm');
          else if (edge.type === 'publishes_to' && target.type === 'queue') needed.add('sqs');
          else if (edge.type === 'publishes_to' && target.type === 'topic') needed.add('sns');
        }
        return [...needed].filter((s) => !allowedServices.includes(s));
      };

      const matches = funcNodes.map((n) => {
        const outEdges = getOutgoingEdges(currentGraph, n.id);
        const missingPermissions = missingFor(outEdges);
        return {
          file: n.type === 'function' ? n.file : undefined,
          accesses: outEdges.map((e) => {
            const target = nodeMap.get(e.to);
            return {
              targetId: e.to,
              edgeType: e.type,
              targetName: target && 'name' in target ? target.name : e.to,
              targetType: target?.type,
            };
          }),
          ...(missingPermissions !== undefined ? { missingPermissions } : {}),
        };
      });

      return toText({
        function: functionName,
        found: true,
        matches,
        ...(matches.length > 1 ? { ambiguous: true } : {}),
        ...(resolvedVia ? { resolvedLambda: resolvedVia } : {}),
        ...(ambiguousLambdas ? { candidateLambdas: ambiguousLambdas } : {}),
        triggers: allTriggers.map((t) => ({
          type: t.type,
          source: t.sourceName,
          eventShape: t.eventShape,
          ...(t.batchSize !== undefined ? { batchSize: t.batchSize } : {}),
          ...(t.reportsBatchItemFailures !== undefined
            ? { reportsBatchItemFailures: t.reportsBatchItemFailures }
            : {}),
          ...(t.ruleName ? { ruleName: t.ruleName, eventPattern: t.eventPattern } : {}),
        })),
        issues: relatedFindings.map((f) => ({
          severity: f.severity,
          issue: f.issue,
          description: f.description,
        })),
        recommendations: [...new Set(relatedFindings.map((f) => f.recommendation))],
      });
    }),
  );

  mcp.registerTool(
    'suggest_gsi',
    {
      description:
        "Generates a ready-to-use DynamoDB GSI definition — index name, partition key, projection type, billing mode — for a given table and attribute. Call this when a query pattern needs an index that does not exist yet, or when the analyzer flags a missing GSI finding. Checks the table's existing indexes first: when one is already keyed on that attribute it returns `alreadyIndexed: true` with the existing index name to use as `IndexName`, instead of proposing a duplicate. Use get_table_schema for the full index list on a table.",
      inputSchema: z.object({
        table: z.string().describe('DynamoDB table name'),
        attribute: z.string().describe('Attribute to create the GSI on'),
      }),
    },
    logged('suggest_gsi', async ({ table: tableName, attribute }) => {
      const sanitizedAttr = attribute.replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const indexName = `${sanitizedTable}-${sanitizedAttr}-index`;
      const tableNode = currentGraph.nodes.find(
        (n) =>
          n.type === 'table' &&
          n.databaseType === 'dynamodb' &&
          'name' in n &&
          n.name === tableName,
      );

      // Index nodes carry their key schema, so a GSI that already serves this
      // attribute can be named instead of duplicated. Creating a second index
      // on the same key costs write capacity on every write, forever.
      const existing = tableNode
        ? currentGraph.edges
            .filter((e) => e.from === tableNode.id && e.type === 'uses_index')
            .map((e) => currentGraph.nodes.find((n) => n.id === e.to))
            .find((n) => n?.type === 'index' && n.partitionKey === attribute)
        : undefined;

      if (existing?.type === 'index') {
        return toText({
          table: tableName,
          attribute,
          found: true,
          alreadyIndexed: true,
          existingIndex: {
            name: existing.name,
            indexType: existing.indexType,
            partitionKey: existing.partitionKey,
            sortKey: existing.sortKey,
            projectionType: existing.projectionType,
          },
          recommendation: `No new index needed. Query "${tableName}" with IndexName: "${existing.name}" — it is already keyed on "${attribute}".`,
        });
      }

      return toText({
        table: tableName,
        attribute,
        found: !!tableNode,
        alreadyIndexed: false,
        index: {
          name: indexName,
          partitionKey: attribute,
          projectionType: 'ALL',
          billingMode: 'PAY_PER_REQUEST',
        },
        rationale: `A GSI on "${attribute}" allows Query instead of Scan when filtering by this attribute.`,
        recommendation: `Add GSI "${indexName}" with partition key "${attribute}" to your IaC definition.`,
      });
    }),
  );

  mcp.registerTool(
    'postgres_index_suggestions',
    {
      description:
        'Generates the exact CREATE INDEX CONCURRENTLY SQL for a PostgreSQL table column, including a partial index variant and a post-creation ANALYZE reminder. Call this when the analyzer flags a missing index finding or when writing a query that filters on a column without an existing index. Does not verify whether the index already exists.',
      inputSchema: z.object({
        table: z.string().describe('PostgreSQL table name'),
        column: z.string().describe('Column name to index'),
      }),
    },
    logged('postgres_index_suggestions', async ({ table: tableName, column }) => {
      const sanitizedCol = column.replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;
      return toText({
        table: tableName,
        column,
        recommendation: `CREATE INDEX CONCURRENTLY ${indexName} ON ${sanitizedTable} (${sanitizedCol});`,
        rationale: `An index on "${column}" eliminates sequential scans when filtering on this column.`,
        notes: [
          'Use CONCURRENTLY to avoid locking the table',
          'Run ANALYZE after creation',
          `Partial index: CREATE INDEX CONCURRENTLY ${indexName}_partial ON ${sanitizedTable} (${sanitizedCol}) WHERE ${sanitizedCol} IS NOT NULL;`,
        ],
      });
    }),
  );

  mcp.registerTool(
    'suggest_mongo_index',
    {
      description:
        'Generates the exact db.collection.createIndex() command for a MongoDB field, plus compound and text index variants and an explain query to verify. Call this when a collection scan is flagged by the analyzer or when writing a query that filters on an unindexed field. Does not check whether the index already exists.',
      inputSchema: z.object({
        collection: z.string().describe('MongoDB collection name'),
        field: z.string().describe('Field name to index'),
      }),
    },
    logged('suggest_mongo_index', async ({ collection, field }) => {
      const sanitizedCollection = collection.replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedField = field.replace(/[^a-zA-Z0-9_.]/g, '_');
      return toText({
        collection,
        field,
        recommendation: `db.${sanitizedCollection}.createIndex({ ${sanitizedField}: 1 })`,
        rationale: `An index on "${field}" eliminates full collection scans when filtering on this field.`,
        notes: [
          `Compound: db.${sanitizedCollection}.createIndex({ ${sanitizedField}: 1, otherField: 1 })`,
          `Text: db.${sanitizedCollection}.createIndex({ ${sanitizedField}: "text" })`,
          `Verify: db.${sanitizedCollection}.explain("executionStats").find({ ${sanitizedField}: value })`,
        ],
      });
    }),
  );

  mcp.registerTool(
    'mysql_index_suggestions',
    {
      description:
        'Generates the exact ALTER TABLE ADD INDEX SQL for a MySQL table column, including a composite variant and EXPLAIN guidance to verify the index is used. Call this when the analyzer flags a missing MySQL index or full table scan finding. Does not verify whether the index already exists.',
      inputSchema: z.object({
        table: z.string().describe('MySQL table name'),
        column: z.string().describe('Column name to index'),
      }),
    },
    logged('mysql_index_suggestions', async ({ table: tableName, column }) => {
      const sanitizedCol = column.replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;
      return toText({
        table: tableName,
        column,
        recommendation: `ALTER TABLE ${sanitizedTable} ADD INDEX ${indexName} (${sanitizedCol});`,
        rationale: `An index on "${column}" eliminates full table scans when filtering on this column.`,
        notes: [
          'MySQL InnoDB adds indexes online (no full lock for 5.6+)',
          'EXPLAIN SELECT ... to verify after adding',
          `Composite: ALTER TABLE ${sanitizedTable} ADD INDEX idx_composite (${sanitizedCol}, other_column);`,
        ],
      });
    }),
  );

  mcp.registerTool(
    'get_queue_details',
    {
      description:
        'Returns all SQS queues with DLQ presence, encryption status, FIFO type (isFifo), visibility timeout, approximate message count, and retention days. When isFifo is true, all SendMessage calls must include a MessageGroupId. Call this when reviewing messaging architecture, investigating a message backlog, checking DLQ coverage, or verifying visibility timeout is set correctly relative to Lambda timeout (should be 6× the Lambda timeout). Use get_infra_overview for a quick queue count only. When runtime signals are enabled, oldestMessageAgeSec reports the age of the oldest message from CloudWatch.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_queue_details', async () => {
      const queues = getQueueNodes(currentGraph);
      const queueFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.queueName,
      );
      return toText({
        total: queues.length,
        queues: queues.map((q) => ({
          name: q.name,
          provider: q.provider,
          hasDLQ: q.hasDLQ,
          encrypted: q.encrypted,
          isFifo: q.isFifo ?? false,
          visibilityTimeoutSec: q.visibilityTimeoutSec,
          approximateMessages: q.approximateMessages,
          retentionDays: q.retentionDays,
          oldestMessageAgeSec: q.oldestMessageAgeSec,
          findings: queueFindings
            .filter((f) => (f.metadata as Record<string, unknown>).queueName === q.name)
            .map((f) => ({ severity: f.severity, issue: f.issue })),
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_topic_details',
    {
      description:
        'Returns all SNS topics with subscription count, encryption status, and filter policies. Filter policies list the message attributes each subscription requires — publishers must include these attributes or messages are silently dropped. Call this before writing any SNS publish code or when reviewing event fan-out patterns.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_topic_details', async () => {
      const topics = getTopicNodes(currentGraph);
      const nodeMap = new Map(currentGraph.nodes.map((n) => [n.id, n]));
      const namesFor = (topicId: string, edgeType: 'publishes_to' | 'subscribes_to') =>
        currentGraph.edges
          .filter((e) => e.to === topicId && e.type === edgeType)
          .map((e) => nodeMap.get(e.from))
          .flatMap((n) => (n && 'name' in n ? [n.name] : []));
      return toText({
        total: topics.length,
        topics: topics.map((t) => ({
          name: t.name,
          provider: t.provider,
          subscriptionCount: t.subscriptionCount,
          encrypted: t.encrypted,
          producers: namesFor(t.id, 'publishes_to'),
          consumers: namesFor(t.id, 'subscribes_to'),
          filterPolicies: t.filterPolicies ?? [],
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_secrets_overview',
    {
      description:
        'Returns all Secrets Manager secrets with rotation status, rotation interval, and referencedKeys — key names (e.g. "password", "apiKey") inferred from application code that parses the secret, never the values. Call this when checking which secrets exist, confirming rotation is enabled before a security review, or before writing code that reads a secret so you use the correct key name instead of guessing.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_secrets_overview', async () => {
      const secrets = getSecretNodes(currentGraph);
      const secretFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.secretName,
      );
      return toText({
        total: secrets.length,
        note: 'Secret values are never included in this response.',
        secrets: secrets.map((s) => ({
          name: s.name,
          provider: s.provider,
          rotationEnabled: s.rotationEnabled,
          rotationDays: s.rotationDays,
          referencedKeys: s.referencedKeys ?? [],
          findings: secretFindings
            .filter((f) => (f.metadata as Record<string, unknown>).secretName === s.name)
            .map((f) => ({ severity: f.severity, issue: f.issue })),
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_parameter_overview',
    {
      description:
        'Returns all SSM Parameter Store parameters with type (String, SecureString, StringList) and tier (Standard, Advanced). Parameter values are never returned. Call this when checking which config parameters exist for a service or verifying parameter types.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_parameter_overview', async () => {
      const parameters = getParameterNodes(currentGraph);
      return toText({
        total: parameters.length,
        note: 'Parameter values are never included in this response.',
        parameters: parameters.map((p) => ({
          name: p.name,
          provider: p.provider,
          type: p.paramType,
          tier: p.tier,
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_lambda_overview',
    {
      description:
        'Returns all Lambda functions with runtime, memory (MB), timeout (sec), environment variable key names (values never returned), and event source triggers with the correct handler event shape for each. Call this when auditing Lambda configuration for default memory (128 MB) or high timeouts, or when you need the trigger event shape for a specific function without running analyze_function. When runtime signals are enabled, recentThrottles and recentErrors report CloudWatch counts for the analysis window. A costSignal note appears when memory is 3008 MB+ and there is no throttling evidence to justify it — no billing API involved, this is a config-level heuristic.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_lambda_overview', async () => {
      const lambdas = getLambdaNodes(currentGraph);
      const lambdaFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.functionName,
      );
      return toText({
        total: lambdas.length,
        note: 'Environment variable values are never included.',
        lambdas: lambdas.map((l) => {
          const costSignal = lambdaCostSignal(l);
          return {
            name: l.name,
            runtime: l.runtime,
            memoryMB: l.memoryMB,
            timeoutSec: l.timeoutSec,
            envVarCount: l.envVarKeys?.length ?? 0,
            envVarKeys: l.envVarKeys,
            roleArn: l.roleArn,
            recentThrottles: l.recentThrottles,
            recentErrors: l.recentErrors,
            ...(costSignal ? { costSignal } : {}),
            ...(l.reservedConcurrency !== undefined
              ? { reservedConcurrency: l.reservedConcurrency }
              : {}),
            triggers: (l.triggers ?? []).map((t) => ({
              type: t.type,
              source: t.sourceName,
              eventShape: t.eventShape,
              state: t.state,
              ...(t.batchSize !== undefined ? { batchSize: t.batchSize } : {}),
              ...(t.reportsBatchItemFailures !== undefined
                ? { reportsBatchItemFailures: t.reportsBatchItemFailures }
                : {}),
            })),
            findings: lambdaFindings
              .filter((f) => (f.metadata as Record<string, unknown>).functionName === l.name)
              .map((f) => ({ severity: f.severity, issue: f.issue })),
          };
        }),
      });
    }),
  );

  mcp.registerTool(
    'get_eventbridge_details',
    {
      description:
        'Returns all EventBridge rules with name, ENABLED/DISABLED state, schedule expression (rate/cron rules), event pattern (event-driven rules), and target Lambda function names. Call this when checking what schedule or event triggers a Lambda, or when reviewing rule coverage across the account.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_eventbridge_details', async () => {
      const rules = getEventBridgeRuleNodes(currentGraph);
      const nodeMap = new Map(currentGraph.nodes.map((n) => [n.id, n]));
      return toText({
        total: rules.length,
        rules: rules.map((r) => ({
          name: r.name,
          state: r.state,
          scheduleExpression: r.scheduleExpression,
          eventPattern: r.eventPattern,
          targets: currentGraph.edges
            .filter((e) => e.from === r.id && e.type === 'triggers')
            .map((e) => nodeMap.get(e.to))
            .filter(Boolean)
            .map((n) => (n && 'name' in n ? n.name : '')),
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_s3_overview',
    {
      description:
        'Returns all S3 buckets with versioning status, encryption, public access configuration, and security findings. Call this when checking which S3 buckets exist, reviewing bucket security posture, or before writing S3 upload/delete handlers to confirm the bucket name. Do NOT call when you only need a quick infrastructure count — use get_infra_overview for that. Object contents are never included.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_s3_overview', async () => {
      const buckets = getBucketNodes(currentGraph);
      const bucketFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.bucketName,
      );
      return toText({
        total: buckets.length,
        note: 'Object contents are never included.',
        buckets: buckets.map((b) => ({
          name: b.name,
          provider: b.provider,
          versioned: b.versioned,
          encrypted: b.encrypted,
          publicAccessBlocked: b.publicAccessBlocked,
          findings: bucketFindings
            .filter((f) => (f.metadata as Record<string, unknown>).bucketName === b.name)
            .map((f) => ({ severity: f.severity, issue: f.issue })),
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_api_routes',
    {
      description:
        'Returns all API Gateway APIs (REST, HTTP, WebSocket) with their routes, HTTP methods, paths, and the Lambda function each route invokes. Call this before writing any API handler to understand which Lambda handles a route, or when reviewing API surface area and Lambda integration coverage.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_api_routes', async () => {
      const apis = getAPINodes(currentGraph);
      return toText({
        total: apis.length,
        apis: apis.map((api) => ({
          name: api.name,
          type: api.apiType,
          routes: (api.routes ?? []).map((r) => ({
            method: r.method,
            path: r.path,
            lambda: r.lambdaName ?? null,
          })),
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_log_errors',
    {
      description:
        'Returns recent error pattern summaries from CloudWatch log groups: pattern counts and frequencies grouped by log group. Raw log messages are never returned. Use the optional logGroup filter to scope to one group by name substring. Call this when investigating errors or identifying log groups with no retention policy.',
      inputSchema: z.object({
        logGroup: z.string().describe('Filter to a specific log group name (optional)').optional(),
        maxAgeSeconds,
      }),
    },
    logged('get_log_errors', async ({ logGroup: filterName }) => {
      const logGroups = getLogGroupNodes(currentGraph).filter(
        (lg) => !filterName || lg.name.includes(filterName),
      );
      return toText({
        note: 'Only error patterns and counts are returned — no raw log messages.',
        windowHours: logWindowHours,
        logGroups: logGroups.map((lg) => ({
          name: lg.name,
          retentionDays: lg.retentionDays ?? 'never-expires',
          errorCount: lg.errorCount,
          topErrorPatterns: lg.topErrorPatterns,
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_table_schema',
    {
      description:
        'Returns the full schema for specific tables or collections by name: columns with data types and nullability, primary keys, foreign keys (join paths), indexes, DynamoDB partition/sort keys and billing mode, and MongoDB estimated document counts. Accepts short names ("orders" matches "public.orders") and is case-insensitive. Call this after get_infra_overview when you need column-level detail to write a SQL query, DynamoDB expression, or MongoDB filter for specific tables — instead of pulling every schema with get_graph_summary. Do NOT call for a table inventory; use get_infra_overview for that. Row data is never included. DynamoDB matches include a costSignal note for provisioned-capacity tables.',
      inputSchema: z.object({
        tables: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe('Table or collection names to fetch schemas for'),
        maxAgeSeconds,
      }),
    },
    logged('get_table_schema', async ({ tables }) => {
      const tableNodes = getTableNodes(currentGraph);
      const indexNamesFor = (nodeId: string) =>
        currentGraph.edges
          .filter((e) => e.from === nodeId && e.type === 'uses_index')
          .map((e) => currentGraph.nodes.find((n) => n.id === e.to))
          .flatMap((n) =>
            n?.type === 'index'
              ? [
                  n.partitionKey === undefined
                    ? { name: n.name }
                    : {
                        name: n.name,
                        indexType: n.indexType,
                        partitionKey: n.partitionKey,
                        ...(n.sortKey ? { sortKey: n.sortKey } : {}),
                        ...(n.projectionType ? { projectionType: n.projectionType } : {}),
                      },
                ]
              : [],
          );

      const results = tables.map((requested) => {
        const lower = requested.toLowerCase();
        const matches = tableNodes.filter((t) => {
          const name = t.name.toLowerCase();
          return name === lower || name.split('.').pop() === lower;
        });
        if (matches.length === 0) {
          const suggestions = tableNodes
            .filter((t) => t.name.toLowerCase().includes(lower))
            .map((t) => t.name)
            .slice(0, 5);
          return { requested, found: false, ...(suggestions.length ? { suggestions } : {}) };
        }
        return {
          requested,
          found: true,
          matches: matches.map((t) => {
            const costSignal = t.databaseType === 'dynamodb' ? dynamoCostSignal(t) : undefined;
            return {
              name: t.name,
              databaseType: t.databaseType,
              ...(t.columns ? { columns: t.columns } : {}),
              ...(t.primaryKeys?.length ? { primaryKeys: t.primaryKeys } : {}),
              ...(t.foreignKeys?.length ? { foreignKeys: t.foreignKeys } : {}),
              ...(t.partitionKey ? { partitionKey: t.partitionKey } : {}),
              ...(t.sortKey ? { sortKey: t.sortKey } : {}),
              ...(t.estimatedCount !== undefined ? { estimatedCount: t.estimatedCount } : {}),
              ...(t.billingMode ? { billingMode: t.billingMode } : {}),
              ...(t.provisionedThroughput
                ? { provisionedThroughput: t.provisionedThroughput }
                : {}),
              ...(costSignal ? { costSignal } : {}),
              indexes: indexNamesFor(t.id),
            };
          }),
        };
      });

      return toText({
        note: 'Row data is never included.',
        tables: results,
      });
    }),
  );

  mcp.registerTool(
    'get_cache_overview',
    {
      description:
        'Returns all ElastiCache clusters with engine, version, node type, node count, in-transit and at-rest encryption status, replication group, and automatic failover state. Call this before writing cache client code (TLS is required when transit encryption is on — rediss:// for Redis) or when reviewing cache availability and security posture. Cached data is never read or included. A costSignal note appears on clusters with more than 3 nodes.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_cache_overview', async () => {
      const caches = getCacheClusterNodes(currentGraph);
      const cacheFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.cacheClusterId,
      );
      return toText({
        total: caches.length,
        note: 'Cached data is never included.',
        caches: caches.map((c) => {
          const costSignal = cacheCostSignal(c);
          return {
            id: c.name,
            engine: c.engine,
            engineVersion: c.engineVersion,
            nodeType: c.nodeType,
            numNodes: c.numNodes,
            transitEncryption: c.transitEncryption,
            atRestEncryption: c.atRestEncryption,
            replicationGroupId: c.replicationGroupId,
            automaticFailover: c.automaticFailover,
            ...(costSignal ? { costSignal } : {}),
            findings: cacheFindings
              .filter((f) => (f.metadata as Record<string, unknown>).cacheClusterId === c.name)
              .map((f) => ({ severity: f.severity, issue: f.issue })),
          };
        }),
      });
    }),
  );

  mcp.registerTool(
    'get_cloudfront_overview',
    {
      description:
        'Returns all CloudFront distributions with, per distribution: id, comment, domain name, alias domains, enabled state, origins (type s3 or custom, domain name, and the resolved API Gateway name when the origin is an execute-api endpoint), and every cache behavior with its path pattern, target origin, cache policy name, viewer protocol policy, and allowed methods. Behaviors are listed in CloudFront match order — ordered behaviors first, the default behavior last. Call this to answer which distribution and behavior serves a given path and which origin it hits, before changing a path-based routing rule, or when reviewing edge caching and HTTPS enforcement across a multi-API front door.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_cloudfront_overview', async () => {
      const distributions = getDistributionNodes(currentGraph);
      const apiNamesById = new Map(getAPINodes(currentGraph).map((a) => [a.id, a.name]));
      const distFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.distributionId,
      );

      return toText({
        total: distributions.length,
        distributions: distributions.map((d) => {
          const originsById = new Map((d.origins ?? []).map((o) => [o.id, o]));
          return {
            id: d.distributionId,
            comment: d.comment,
            domainName: d.domainName,
            aliases: d.aliases ?? [],
            enabled: d.enabled,
            origins: (d.origins ?? []).map((o) => {
              const apiId = /^([a-z0-9]+)\.execute-api\./.exec(o.domainName)?.[1];
              const api = apiId ? apiNamesById.get(`api:aws:${apiId}`) : undefined;
              return {
                id: o.id,
                domainName: o.domainName,
                originType: o.originType,
                originPath: o.originPath,
                ...(api ? { api } : {}),
              };
            }),
            behaviors: (d.behaviors ?? []).map((b) => ({
              pathPattern: b.pathPattern,
              origin: b.targetOriginId,
              originDomain: originsById.get(b.targetOriginId)?.domainName,
              cachePolicy: b.cachePolicy,
              viewerProtocolPolicy: b.viewerProtocolPolicy,
              allowedMethods: b.allowedMethods,
              isDefault: b.isDefault,
            })),
            findings: distFindings
              .filter(
                (f) => (f.metadata as Record<string, unknown>).distributionId === d.distributionId,
              )
              .map((f) => ({ severity: f.severity, issue: f.issue })),
          };
        }),
      });
    }),
  );

  mcp.registerTool(
    'get_stream_details',
    {
      description:
        'Returns all Kinesis data streams (status, shard count, retention hours, encryption, capacity mode) and Amazon MSK clusters (state, cluster type, Kafka version, broker count). Call this when writing Kinesis producer or consumer code, checking whether a stream is PROVISIONED or ON_DEMAND before writing PutRecord calls, or reviewing streaming architecture. For Kafka topic-level producer/consumer mappings extracted from application code, use get_topic_details instead.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_stream_details', async () => {
      const streams = getStreamNodes(currentGraph);
      const clusters = getKafkaClusterNodes(currentGraph);
      return toText({
        totalStreams: streams.length,
        totalKafkaClusters: clusters.length,
        streams: streams.map((s) => ({
          name: s.name,
          status: s.status,
          shardCount: s.shardCount,
          retentionHours: s.retentionHours,
          encrypted: s.encrypted,
          mode: s.mode,
        })),
        kafkaClusters: clusters.map((c) => ({
          name: c.name,
          state: c.state,
          clusterType: c.clusterType,
          kafkaVersion: c.kafkaVersion,
          brokerNodes: c.brokerNodes,
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_cognito_overview',
    {
      description:
        'Returns all Cognito user pools with MFA configuration and every app client config: allowed auth flows, OAuth flows/scopes, callback URLs, token validity, and whether the client has a secret (SDK auth calls must send SECRET_HASH when true). Client secret values are never returned. Call this before writing any Cognito sign-in, sign-up, or token-refresh code to use the correct auth flow and client settings. Do NOT call to look up users or tokens — infrawise never reads user data.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_cognito_overview', async () => {
      const pools = getUserPoolNodes(currentGraph);
      return toText({
        total: pools.length,
        note: 'Client secret values and user data are never included.',
        userPools: pools.map((p) => ({
          name: p.name,
          id: p.poolId,
          mfaConfiguration: p.mfaConfiguration,
          clients: p.clients ?? [],
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_stack_outputs',
    {
      description:
        'Returns all stack outputs and cross-stack exports parsed from local IaC files: Terraform output blocks and CloudFormation/CDK Outputs sections, with name, description, export name, and the raw value expression. Call this when wiring cross-stack references (Fn::ImportValue, terraform_remote_state) or when you need the exported name of a resource defined in another stack. Do NOT call for live resource attributes — outputs come from local IaC files, not the deployed stack. CDK outputs carry `stale: true` with a `staleReason` when their cdk.out template is no longer instantiated in the CDK app or predates the last `cdk synth` — do not rely on a stale export without re-synthesizing.',
      inputSchema: z.object({
        maxAgeSeconds,
      }),
    },
    logged('get_stack_outputs', async () => {
      const outputs = getStackOutputNodes(currentGraph);
      return toText({
        total: outputs.length,
        outputs: outputs.map((o) => ({
          name: o.name,
          description: o.description,
          exportName: o.exportName,
          value: o.value,
          source: o.iacSource,
          file: o.file,
          ...(o.stale ? { stale: true, staleReason: o.staleReason } : {}),
        })),
      });
    }),
  );

  return mcp;
}

// ── Fastify server ────────────────────────────────────────────────────────────

export function createServer(port = 3000) {
  const fastify = Fastify({ logger: false });
  fastify.register(cors, { origin: true });

  fastify.get('/health', async () => ({
    status: 'ok',
    version,
    graphNodes: currentGraph.nodes.length,
    graphEdges: currentGraph.edges.length,
    findings: currentFindings.length,
  }));

  fastify.get('/.well-known/mcp/server-card.json', async () => ({
    schema_version: '2026-01',
    name: 'io.github.Sidd27/infrawise',
    display_name: 'Infrawise',
    version,
    description:
      'Infrastructure analysis MCP server — scans DynamoDB, PostgreSQL, MySQL, MongoDB, S3, Lambda, SQS, SNS, EventBridge, Secrets Manager, SSM, CloudWatch, Terraform, CDK, and source code. Surfaces missing indexes, DLQ gaps, Lambda misconfig, S3 security posture, and correct trigger event shapes.',
    homepage: 'https://github.com/Sidd27/infrawise',
    repository: 'https://github.com/Sidd27/infrawise',
    transports: [{ type: 'streamable-http', url: `http://localhost:${port}/mcp` }],
    tools: TOOLS.map((t) => t.name),
  }));

  fastify.post('/mcp', async (request, reply) => {
    // Fresh McpServer per request: connect() is one-shot per instance and throws if called
    // on a live server, so a shared instance breaks under concurrent requests.
    const mcp = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on('close', () => transport.close());
    await mcp.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    return reply;
  });

  return {
    fastify,
    start: async () => {
      try {
        await fastify.listen({ port, host: '0.0.0.0' });
        logger.info(`Infrawise MCP server running at http://localhost:${port}`);
      } catch (e) {
        logger.error(`Failed to start server: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    },
  };
}

export { currentGraph, currentFindings };
