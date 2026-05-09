import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { SystemGraph, Finding } from '../types';
import { logger } from '../core';
import { summarizeFindings } from '../analyzers';
import {
  getTableNodes,
  getFunctionNodes,
  getQueueNodes,
  getTopicNodes,
  getSecretNodes,
  getParameterNodes,
  getLogGroupNodes,
  getLambdaNodes,
  getScanEdges,
  getOutgoingEdges,
} from '../graph';

// ── State ────────────────────────────────────────────────────────────────────

let currentGraph: SystemGraph = { nodes: [], edges: [] };
let currentFindings: Finding[] = [];

export function setGraphState(graph: SystemGraph, findings: Finding[]): void {
  currentGraph = graph;
  currentFindings = findings;
}

// ── Tool types ────────────────────────────────────────────────────────────────

type ToolResult = { content: [{ type: 'text'; text: string }] };
type ToolArgs = Record<string, unknown>;

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: ToolArgs) => Promise<ToolResult>;
}

function toText(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'get_infra_overview',
    description: 'Returns a complete snapshot of all infrastructure: databases, queues, topics, secrets, parameters, log groups, lambdas, and all findings. Start here for a full picture.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const tables = getTableNodes(currentGraph);
      const queues = getQueueNodes(currentGraph);
      const topics = getTopicNodes(currentGraph);
      const secrets = getSecretNodes(currentGraph);
      const parameters = getParameterNodes(currentGraph);
      const logGroups = getLogGroupNodes(currentGraph);
      const lambdas = getLambdaNodes(currentGraph);
      const functions = getFunctionNodes(currentGraph);
      return toText({
        summary: {
          tables: tables.length, functions: functions.length,
          queues: queues.length, topics: topics.length,
          secrets: secrets.length, parameters: parameters.length,
          logGroups: logGroups.length, lambdas: lambdas.length,
          totalNodes: currentGraph.nodes.length, totalEdges: currentGraph.edges.length,
          findings: summarizeFindings(currentFindings),
        },
        databases: tables.map((t) => ({ name: t.name, type: t.databaseType })),
        queues: queues.map((q) => ({ name: q.name, hasDLQ: q.hasDLQ, encrypted: q.encrypted, approximateMessages: q.approximateMessages })),
        topics: topics.map((t) => ({ name: t.name, subscriptions: t.subscriptionCount })),
        secrets: secrets.map((s) => ({ name: s.name, rotationEnabled: s.rotationEnabled })),
        parameters: parameters.map((p) => ({ name: p.name, type: p.paramType, tier: p.tier })),
        lambdas: lambdas.map((l) => ({ name: l.name, runtime: l.runtime, memoryMB: l.memoryMB })),
        logGroups: logGroups.map((lg) => ({ name: lg.name, retentionDays: lg.retentionDays ?? 'never', errorCount: lg.errorCount })),
        highFindings: currentFindings.filter((f) => f.severity === 'high').map((f) => ({ issue: f.issue, recommendation: f.recommendation })),
      });
    },
  },
  {
    name: 'get_graph_summary',
    description: 'Returns the full infrastructure graph (all nodes and edges) plus findings summary.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => toText({
      nodes: currentGraph.nodes,
      edges: currentGraph.edges,
      findings: currentFindings,
      summary: {
        totalNodes: currentGraph.nodes.length, totalEdges: currentGraph.edges.length,
        tables: getTableNodes(currentGraph).length, functions: getFunctionNodes(currentGraph).length,
        queues: getQueueNodes(currentGraph).length, scans: getScanEdges(currentGraph).length,
        ...summarizeFindings(currentFindings),
      },
    }),
  },
  {
    name: 'analyze_function',
    description: 'Analyze a specific function for all infrastructure issues: DB queries, queue publishing, secret access, etc.',
    inputSchema: {
      type: 'object',
      properties: { function: { type: 'string', description: 'Function name to analyze' } },
      required: ['function'],
    },
    handler: async ({ function: functionName }) => {
      const funcNode = currentGraph.nodes.find((n) => n.type === 'function' && n.name === functionName);
      if (!funcNode) {
        return toText({ function: functionName, found: false, issues: [], recommendations: [`Function "${String(functionName)}" not found in the analyzed codebase.`] });
      }
      const outEdges = getOutgoingEdges(currentGraph, funcNode.id);
      const relatedFindings = currentFindings.filter((f) => {
        const meta = f.metadata as Record<string, unknown> | undefined;
        return meta?.functionName === functionName || String(meta?.callerFunctions ?? '').includes(String(functionName));
      });
      return toText({
        function: functionName, found: true,
        file: funcNode.type === 'function' ? funcNode.file : undefined,
        accesses: outEdges.map((e) => {
          const target = currentGraph.nodes.find((n) => n.id === e.to);
          return { targetId: e.to, edgeType: e.type, targetName: target && 'name' in target ? target.name : e.to, targetType: target?.type };
        }),
        issues: relatedFindings.map((f) => ({ severity: f.severity, issue: f.issue, description: f.description })),
        recommendations: [...new Set(relatedFindings.map((f) => f.recommendation))],
      });
    },
  },
  {
    name: 'suggest_gsi',
    description: 'Get GSI suggestions for a DynamoDB table and attribute',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'DynamoDB table name' },
        attribute: { type: 'string', description: 'Attribute to create the GSI on' },
      },
      required: ['table', 'attribute'],
    },
    handler: async ({ table: tableName, attribute }) => {
      const sanitizedAttr = String(attribute).replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `${String(tableName)}-${sanitizedAttr}-index`;
      const tableNode = currentGraph.nodes.find((n) => n.type === 'table' && n.databaseType === 'dynamodb' && 'name' in n && n.name === tableName);
      return toText({
        table: tableName, attribute, found: !!tableNode,
        index: { name: indexName, partitionKey: attribute, projectionType: 'ALL', billingMode: 'PAY_PER_REQUEST' },
        rationale: `A GSI on "${String(attribute)}" allows Query instead of Scan when filtering by this attribute.`,
        recommendation: `Add GSI "${indexName}" with partition key "${String(attribute)}" to your IaC definition.`,
      });
    },
  },
  {
    name: 'postgres_index_suggestions',
    description: 'Get PostgreSQL index suggestions for a table column',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'PostgreSQL table name' },
        column: { type: 'string', description: 'Column name to index' },
      },
      required: ['table', 'column'],
    },
    handler: async ({ table: tableName, column }) => {
      const sanitizedCol = String(column).replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedTable = String(tableName).replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;
      return toText({
        table: tableName, column,
        recommendation: `CREATE INDEX CONCURRENTLY ${indexName} ON ${String(tableName)} (${String(column)});`,
        rationale: `An index on "${String(column)}" eliminates sequential scans when filtering on this column.`,
        notes: ['Use CONCURRENTLY to avoid locking the table', 'Run ANALYZE after creation',
          `Partial index: CREATE INDEX CONCURRENTLY ${indexName}_partial ON ${String(tableName)} (${String(column)}) WHERE ${String(column)} IS NOT NULL;`],
      });
    },
  },
  {
    name: 'suggest_mongo_index',
    description: 'Get index suggestions for a MongoDB collection field',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'MongoDB collection name' },
        field: { type: 'string', description: 'Field name to index' },
      },
      required: ['collection', 'field'],
    },
    handler: async ({ collection, field }) => toText({
      collection, field,
      recommendation: `db.${String(collection)}.createIndex({ ${String(field)}: 1 })`,
      rationale: `An index on "${String(field)}" eliminates full collection scans when filtering on this field.`,
      notes: [
        `Compound: db.${String(collection)}.createIndex({ ${String(field)}: 1, otherField: 1 })`,
        `Text: db.${String(collection)}.createIndex({ ${String(field)}: "text" })`,
        `Verify: db.${String(collection)}.explain("executionStats").find({ ${String(field)}: value })`,
      ],
    }),
  },
  {
    name: 'mysql_index_suggestions',
    description: 'Get MySQL index suggestions for a table column',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'MySQL table name' },
        column: { type: 'string', description: 'Column name to index' },
      },
      required: ['table', 'column'],
    },
    handler: async ({ table: tableName, column }) => {
      const sanitizedCol = String(column).replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedTable = String(tableName).replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;
      return toText({
        table: tableName, column,
        recommendation: `ALTER TABLE ${String(tableName)} ADD INDEX ${indexName} (${String(column)});`,
        rationale: `An index on "${String(column)}" eliminates full table scans when filtering on this column.`,
        notes: ['MySQL InnoDB adds indexes online (no full lock for 5.6+)', 'EXPLAIN SELECT ... to verify after adding',
          `Composite: ALTER TABLE ${String(tableName)} ADD INDEX idx_composite (${String(column)}, other_column);`],
      });
    },
  },
  {
    name: 'get_queue_details',
    description: 'Returns all SQS queues with DLQ status, encryption, message counts, and retention.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const queues = getQueueNodes(currentGraph);
      const queueFindings = currentFindings.filter((f) => (f.metadata as Record<string, unknown> | undefined)?.queueName);
      return toText({
        total: queues.length,
        queues: queues.map((q) => ({
          name: q.name, provider: q.provider, hasDLQ: q.hasDLQ, encrypted: q.encrypted,
          approximateMessages: q.approximateMessages, retentionDays: q.retentionDays,
          findings: queueFindings.filter((f) => (f.metadata as Record<string, unknown>).queueName === q.name).map((f) => ({ severity: f.severity, issue: f.issue })),
        })),
      });
    },
  },
  {
    name: 'get_topic_details',
    description: 'Returns all SNS topics with subscription counts and protocols.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const topics = getTopicNodes(currentGraph);
      return toText({ total: topics.length, topics: topics.map((t) => ({ name: t.name, provider: t.provider, subscriptionCount: t.subscriptionCount, encrypted: t.encrypted })) });
    },
  },
  {
    name: 'get_secrets_overview',
    description: 'Returns all Secrets Manager secrets: names, rotation status. Secret VALUES are never included.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const secrets = getSecretNodes(currentGraph);
      const secretFindings = currentFindings.filter((f) => (f.metadata as Record<string, unknown> | undefined)?.secretName);
      return toText({
        total: secrets.length, note: 'Secret values are never included in this response.',
        secrets: secrets.map((s) => ({
          name: s.name, provider: s.provider, rotationEnabled: s.rotationEnabled, rotationDays: s.rotationDays,
          findings: secretFindings.filter((f) => (f.metadata as Record<string, unknown>).secretName === s.name).map((f) => ({ severity: f.severity, issue: f.issue })),
        })),
      });
    },
  },
  {
    name: 'get_parameter_overview',
    description: 'Returns all SSM Parameter Store parameters: names, types, tiers. Parameter VALUES are never included.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const parameters = getParameterNodes(currentGraph);
      return toText({
        total: parameters.length, note: 'Parameter values are never included in this response.',
        parameters: parameters.map((p) => ({ name: p.name, provider: p.provider, type: p.paramType, tier: p.tier })),
      });
    },
  },
  {
    name: 'get_lambda_overview',
    description: 'Returns all Lambda functions: runtime, memory, timeout, env var key names (values never included).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const lambdas = getLambdaNodes(currentGraph);
      const lambdaFindings = currentFindings.filter((f) => (f.metadata as Record<string, unknown> | undefined)?.functionName);
      return toText({
        total: lambdas.length, note: 'Environment variable values are never included.',
        lambdas: lambdas.map((l) => ({
          name: l.name, runtime: l.runtime, memoryMB: l.memoryMB, timeoutSec: l.timeoutSec,
          envVarCount: l.envVarKeys?.length ?? 0, envVarKeys: l.envVarKeys,
          findings: lambdaFindings.filter((f) => (f.metadata as Record<string, unknown>).functionName === l.name).map((f) => ({ severity: f.severity, issue: f.issue })),
        })),
      });
    },
  },
  {
    name: 'get_log_errors',
    description: 'Returns recent error patterns from CloudWatch log groups. Returns pattern counts and frequencies — never raw log messages.',
    inputSchema: {
      type: 'object',
      properties: { logGroup: { type: 'string', description: 'Filter to a specific log group name (optional)' } },
    },
    handler: async ({ logGroup: filterName }) => {
      const logGroups = getLogGroupNodes(currentGraph).filter((lg) => !filterName || lg.name.includes(String(filterName)));
      return toText({
        note: 'Only error patterns and counts are returned — no raw log messages.',
        windowHours: 24,
        logGroups: logGroups.map((lg) => ({ name: lg.name, retentionDays: lg.retentionDays ?? 'never-expires', errorCount: lg.errorCount, topErrorPatterns: lg.topErrorPatterns })),
      });
    },
  },
];

// ── MCP JSON-RPC ─────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handleMcp(body: JsonRpcRequest): Promise<unknown> {
  const { method, params = {}, id } = body;

  if (method === 'initialize') {
    return ok(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'infrawise', version: '0.1.0' } });
  }

  if (method === 'notifications/initialized' || method === 'ping') {
    return id != null ? ok(id, {}) : null;
  }

  if (method === 'tools/list') {
    return ok(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params as { name: string; arguments?: ToolArgs };
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return rpcErr(id, -32601, `Unknown tool: ${name}`);
    logger.info(`→ ${name}${Object.keys(args).length ? `  ${JSON.stringify(args)}` : ''}`);
    try {
      return ok(id, await tool.handler(args));
    } catch (e) {
      return rpcErr(id, -32603, e instanceof Error ? e.message : String(e));
    }
  }

  return rpcErr(id, -32601, `Method not found: ${method}`);
}

// ── Fastify server ────────────────────────────────────────────────────────────

export function createServer(port = 3000) {
  const fastify = Fastify({ logger: false });
  fastify.register(cors, { origin: true });

  fastify.get('/health', async () => ({
    status: 'ok', version: '0.1.0',
    graphNodes: currentGraph.nodes.length,
    graphEdges: currentGraph.edges.length,
    findings: currentFindings.length,
  }));

  fastify.get('/mcp/tools', async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  fastify.post('/mcp', async (request, reply) => {
    const response = await handleMcp(request.body as JsonRpcRequest);
    if (response === null) return reply.code(204).send();
    return response;
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
