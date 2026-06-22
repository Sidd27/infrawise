import { readFileSync } from 'fs';
import { join } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { SystemGraph, Finding } from '../types.js';
import { logger } from '../core/index.js';

const { version } = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
) as { version: string };
import { summarizeFindings } from '../analyzers/index.js';
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
  getScanEdges,
  getOutgoingEdges,
} from '../graph/index.js';

// ── State ────────────────────────────────────────────────────────────────────

let currentGraph: SystemGraph = { nodes: [], edges: [] };
let currentFindings: Finding[] = [];
// False when the server booted without an infrawise.yaml (e.g. a hosted MCP
// runtime). Used to return a "run locally" hint instead of a bare empty graph.
let configured = true;

export function setGraphState(graph: SystemGraph, findings: Finding[]): void {
  currentGraph = graph;
  currentFindings = findings;
}

export function setConfigured(value: boolean): void {
  configured = value;
}

const NOT_CONFIGURED_HINT =
  'No infrastructure loaded. infrawise reads your live infra locally — run `npx infrawise start` in your project (with AWS credentials and an infrawise.yaml) so these tools return your real DynamoDB/RDS/SQS/Lambda/etc. context. A remotely hosted instance has no access to your cloud account or code, so it returns empty results by design.';

// ── Helpers ──────────────────────────────────────────────────────────────────

function toText(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function logged<T extends Record<string, unknown>>(
  name: string,
  fn: (args: T) => Promise<ReturnType<typeof toText>>,
) {
  return async (args: T) => {
    const hasArgs = Object.keys(args).length > 0;
    logger.info(`→ ${name}${hasArgs ? `  ${JSON.stringify(args)}` : ''}`);
    return fn(args);
  };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'infrawise', version });

  mcp.registerTool(
    'get_infra_overview',
    {
      description:
        'Returns a compact infrastructure snapshot: service counts, all databases, queues, topics, secrets, lambdas, and high-severity findings. Call this first at the start of any database or infrastructure task to understand what services are in scope. Prefer this over get_graph_summary for quick orientation; use get_graph_summary only when you need every node, edge, and finding in full. Also returns a `configured` flag — when false, the server has no infrawise.yaml loaded (e.g. a remotely hosted instance) and all tools return empty results; a `setupHint` explains how to run infrawise locally.',
      inputSchema: z.object({}),
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
      inputSchema: z.object({}),
    },
    logged('get_graph_summary', async () =>
      toText({
        nodes: currentGraph.nodes,
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
        'Analyzes a single named function or Lambda handler for infrastructure issues: which tables it queries, how it queries them (scan vs query), queue publishing, secret access, and the correct event shape for each trigger (SQS, DynamoDB Streams, Kinesis, EventBridge). Call this before writing or reviewing a Lambda handler to get the exact trigger event shape and all findings scoped to this function. Returns found: false if the function name was not discovered during analysis.',
      inputSchema: z.object({ function: z.string().describe('Function name to analyze') }),
    },
    logged('analyze_function', async ({ function: functionName }) => {
      const funcNode = currentGraph.nodes.find(
        (n) => n.type === 'function' && n.name === functionName,
      );

      // Also check if there's a Lambda node with this name (for AWS-deployed functions)
      const lambdaNode = currentGraph.nodes.find(
        (n) => n.type === 'lambda' && n.name === functionName,
      );

      if (!funcNode && !lambdaNode) {
        return toText({
          function: functionName,
          found: false,
          issues: [],
          recommendations: [`Function "${functionName}" not found in the analyzed codebase.`],
        });
      }

      const outEdges = funcNode ? getOutgoingEdges(currentGraph, funcNode.id) : [];
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
      let missingPermissions: string[] | undefined;
      if (allowedServices && !allowedServices.includes('*') && funcNode) {
        const nodeMap = new Map(currentGraph.nodes.map((n) => [n.id, n]));
        const needed = new Set<string>();
        for (const edge of outEdges) {
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
        missingPermissions = [...needed].filter((s) => !allowedServices.includes(s));
      }

      return toText({
        function: functionName,
        found: true,
        file: funcNode?.type === 'function' ? funcNode.file : undefined,
        triggers: allTriggers.map((t) => ({
          type: t.type,
          source: t.sourceName,
          eventShape: t.eventShape,
          ...(t.ruleName ? { ruleName: t.ruleName, eventPattern: t.eventPattern } : {}),
        })),
        accesses: outEdges.map((e) => {
          const target = currentGraph.nodes.find((n) => n.id === e.to);
          return {
            targetId: e.to,
            edgeType: e.type,
            targetName: target && 'name' in target ? target.name : e.to,
            targetType: target?.type,
          };
        }),
        ...(missingPermissions !== undefined ? { missingPermissions } : {}),
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
        'Generates a ready-to-use DynamoDB GSI definition — index name, partition key, projection type, billing mode — for a given table and attribute. Call this when a query pattern needs an index that does not exist yet, or when the analyzer flags a missing GSI finding. Does not verify whether the GSI already exists; check the table schema in get_infra_overview first.',
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
      return toText({
        table: tableName,
        attribute,
        found: !!tableNode,
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
        'Returns all SQS queues with DLQ presence, encryption status, FIFO type (isFifo), visibility timeout, approximate message count, and retention days. When isFifo is true, all SendMessage calls must include a MessageGroupId. Call this when reviewing messaging architecture, investigating a message backlog, checking DLQ coverage, or verifying visibility timeout is set correctly relative to Lambda timeout (should be 6× the Lambda timeout). Use get_infra_overview for a quick queue count only.',
      inputSchema: z.object({}),
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
      inputSchema: z.object({}),
    },
    logged('get_topic_details', async () => {
      const topics = getTopicNodes(currentGraph);
      return toText({
        total: topics.length,
        topics: topics.map((t) => ({
          name: t.name,
          provider: t.provider,
          subscriptionCount: t.subscriptionCount,
          encrypted: t.encrypted,
          filterPolicies: t.filterPolicies ?? [],
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_secrets_overview',
    {
      description:
        'Returns all Secrets Manager secrets with rotation status and rotation interval. Secret values are never returned. Call this when checking which secrets exist, confirming rotation is enabled before a security review, or identifying secrets that lack rotation.',
      inputSchema: z.object({}),
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
      inputSchema: z.object({}),
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
        'Returns all Lambda functions with runtime, memory (MB), timeout (sec), environment variable key names (values never returned), and event source triggers with the correct handler event shape for each. Call this when auditing Lambda configuration for default memory (128 MB) or high timeouts, or when you need the trigger event shape for a specific function without running analyze_function.',
      inputSchema: z.object({}),
    },
    logged('get_lambda_overview', async () => {
      const lambdas = getLambdaNodes(currentGraph);
      const lambdaFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.functionName,
      );
      return toText({
        total: lambdas.length,
        note: 'Environment variable values are never included.',
        lambdas: lambdas.map((l) => ({
          name: l.name,
          runtime: l.runtime,
          memoryMB: l.memoryMB,
          timeoutSec: l.timeoutSec,
          envVarCount: l.envVarKeys?.length ?? 0,
          envVarKeys: l.envVarKeys,
          roleArn: l.roleArn,
          triggers: (l.triggers ?? []).map((t) => ({
            type: t.type,
            source: t.sourceName,
            eventShape: t.eventShape,
            state: t.state,
          })),
          findings: lambdaFindings
            .filter((f) => (f.metadata as Record<string, unknown>).functionName === l.name)
            .map((f) => ({ severity: f.severity, issue: f.issue })),
        })),
      });
    }),
  );

  mcp.registerTool(
    'get_eventbridge_details',
    {
      description:
        'Returns all EventBridge rules with name, ENABLED/DISABLED state, schedule expression (rate/cron rules), event pattern (event-driven rules), and target Lambda function names. Call this when checking what schedule or event triggers a Lambda, or when reviewing rule coverage across the account.',
      inputSchema: z.object({}),
    },
    logged('get_eventbridge_details', async () => {
      const rules = getEventBridgeRuleNodes(currentGraph);
      return toText({
        total: rules.length,
        rules: rules.map((r) => ({
          name: r.name,
          state: r.state,
          scheduleExpression: r.scheduleExpression,
          eventPattern: r.eventPattern,
          targets: currentGraph.edges
            .filter((e) => e.from === r.id && e.type === 'triggers')
            .map((e) => currentGraph.nodes.find((n) => n.id === e.to))
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
      inputSchema: z.object({}),
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
      inputSchema: z.object({}),
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
      }),
    },
    logged('get_log_errors', async ({ logGroup: filterName }) => {
      const logGroups = getLogGroupNodes(currentGraph).filter(
        (lg) => !filterName || lg.name.includes(filterName),
      );
      return toText({
        note: 'Only error patterns and counts are returned — no raw log messages.',
        windowHours: 24,
        logGroups: logGroups.map((lg) => ({
          name: lg.name,
          retentionDays: lg.retentionDays ?? 'never-expires',
          errorCount: lg.errorCount,
          topErrorPatterns: lg.topErrorPatterns,
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
    tools: [
      'get_infra_overview',
      'get_graph_summary',
      'analyze_function',
      'suggest_gsi',
      'postgres_index_suggestions',
      'suggest_mongo_index',
      'mysql_index_suggestions',
      'get_queue_details',
      'get_topic_details',
      'get_secrets_overview',
      'get_parameter_overview',
      'get_lambda_overview',
      'get_eventbridge_details',
      'get_s3_overview',
      'get_api_routes',
      'get_log_errors',
    ],
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
