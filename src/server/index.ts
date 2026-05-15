import { readFileSync } from 'fs';
import { join } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { SystemGraph, Finding } from '../types';
import { logger } from '../core';

const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string };
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function toText(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function logged<T extends Record<string, unknown>>(name: string, fn: (args: T) => Promise<ReturnType<typeof toText>>) {
  return async (args: T) => {
    const hasArgs = Object.keys(args).length > 0;
    logger.info(`→ ${name}${hasArgs ? `  ${JSON.stringify(args)}` : ''}`);
    return fn(args);
  };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'infrawise', version });

  mcp.registerTool('get_infra_overview', {
    description: 'Returns a complete snapshot of all infrastructure: databases, queues, topics, secrets, parameters, log groups, lambdas, and all findings. Start here for a full picture.',
    inputSchema: z.object({}),
  }, logged('get_infra_overview', async () => {
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
  }));

  mcp.registerTool('get_graph_summary', {
    description: 'Returns the full infrastructure graph (all nodes and edges) plus findings summary.',
    inputSchema: z.object({}),
  }, logged('get_graph_summary', async () => toText({
    nodes: currentGraph.nodes,
    edges: currentGraph.edges,
    findings: currentFindings,
    summary: {
      totalNodes: currentGraph.nodes.length, totalEdges: currentGraph.edges.length,
      tables: getTableNodes(currentGraph).length, functions: getFunctionNodes(currentGraph).length,
      queues: getQueueNodes(currentGraph).length, scans: getScanEdges(currentGraph).length,
      ...summarizeFindings(currentFindings),
    },
  })));

  mcp.registerTool('analyze_function', {
    description: 'Analyze a specific function for all infrastructure issues: DB queries, queue publishing, secret access, etc.',
    inputSchema: z.object({ function: z.string().describe('Function name to analyze') }),
  }, logged('analyze_function', async ({ function: functionName }) => {
    const funcNode = currentGraph.nodes.find((n) => n.type === 'function' && n.name === functionName);
    if (!funcNode) {
      return toText({ function: functionName, found: false, issues: [], recommendations: [`Function "${functionName}" not found in the analyzed codebase.`] });
    }
    const outEdges = getOutgoingEdges(currentGraph, funcNode.id);
    const relatedFindings = currentFindings.filter((f) => {
      const meta = f.metadata as Record<string, unknown> | undefined;
      return meta?.functionName === functionName || String(meta?.callerFunctions ?? '').includes(functionName);
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
  }));

  mcp.registerTool('suggest_gsi', {
    description: 'Get GSI suggestions for a DynamoDB table and attribute',
    inputSchema: z.object({
      table: z.string().describe('DynamoDB table name'),
      attribute: z.string().describe('Attribute to create the GSI on'),
    }),
  }, logged('suggest_gsi', async ({ table: tableName, attribute }) => {
    const sanitizedAttr = attribute.replace(/[^a-zA-Z0-9_]/g, '_');
    const indexName = `${tableName}-${sanitizedAttr}-index`;
    const tableNode = currentGraph.nodes.find((n) => n.type === 'table' && n.databaseType === 'dynamodb' && 'name' in n && n.name === tableName);
    return toText({
      table: tableName, attribute, found: !!tableNode,
      index: { name: indexName, partitionKey: attribute, projectionType: 'ALL', billingMode: 'PAY_PER_REQUEST' },
      rationale: `A GSI on "${attribute}" allows Query instead of Scan when filtering by this attribute.`,
      recommendation: `Add GSI "${indexName}" with partition key "${attribute}" to your IaC definition.`,
    });
  }));

  mcp.registerTool('postgres_index_suggestions', {
    description: 'Get PostgreSQL index suggestions for a table column',
    inputSchema: z.object({
      table: z.string().describe('PostgreSQL table name'),
      column: z.string().describe('Column name to index'),
    }),
  }, logged('postgres_index_suggestions', async ({ table: tableName, column }) => {
    const sanitizedCol = column.replace(/[^a-zA-Z0-9_]/g, '_');
    const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
    const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;
    return toText({
      table: tableName, column,
      recommendation: `CREATE INDEX CONCURRENTLY ${indexName} ON ${tableName} (${column});`,
      rationale: `An index on "${column}" eliminates sequential scans when filtering on this column.`,
      notes: ['Use CONCURRENTLY to avoid locking the table', 'Run ANALYZE after creation',
        `Partial index: CREATE INDEX CONCURRENTLY ${indexName}_partial ON ${tableName} (${column}) WHERE ${column} IS NOT NULL;`],
    });
  }));

  mcp.registerTool('suggest_mongo_index', {
    description: 'Get index suggestions for a MongoDB collection field',
    inputSchema: z.object({
      collection: z.string().describe('MongoDB collection name'),
      field: z.string().describe('Field name to index'),
    }),
  }, logged('suggest_mongo_index', async ({ collection, field }) => toText({
    collection, field,
    recommendation: `db.${collection}.createIndex({ ${field}: 1 })`,
    rationale: `An index on "${field}" eliminates full collection scans when filtering on this field.`,
    notes: [
      `Compound: db.${collection}.createIndex({ ${field}: 1, otherField: 1 })`,
      `Text: db.${collection}.createIndex({ ${field}: "text" })`,
      `Verify: db.${collection}.explain("executionStats").find({ ${field}: value })`,
    ],
  })));

  mcp.registerTool('mysql_index_suggestions', {
    description: 'Get MySQL index suggestions for a table column',
    inputSchema: z.object({
      table: z.string().describe('MySQL table name'),
      column: z.string().describe('Column name to index'),
    }),
  }, logged('mysql_index_suggestions', async ({ table: tableName, column }) => {
    const sanitizedCol = column.replace(/[^a-zA-Z0-9_]/g, '_');
    const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
    const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;
    return toText({
      table: tableName, column,
      recommendation: `ALTER TABLE ${tableName} ADD INDEX ${indexName} (${column});`,
      rationale: `An index on "${column}" eliminates full table scans when filtering on this column.`,
      notes: ['MySQL InnoDB adds indexes online (no full lock for 5.6+)', 'EXPLAIN SELECT ... to verify after adding',
        `Composite: ALTER TABLE ${tableName} ADD INDEX idx_composite (${column}, other_column);`],
    });
  }));

  mcp.registerTool('get_queue_details', {
    description: 'Returns all SQS queues with DLQ status, encryption, message counts, and retention.',
    inputSchema: z.object({}),
  }, logged('get_queue_details', async () => {
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
  }));

  mcp.registerTool('get_topic_details', {
    description: 'Returns all SNS topics with subscription counts and protocols.',
    inputSchema: z.object({}),
  }, logged('get_topic_details', async () => {
    const topics = getTopicNodes(currentGraph);
    return toText({ total: topics.length, topics: topics.map((t) => ({ name: t.name, provider: t.provider, subscriptionCount: t.subscriptionCount, encrypted: t.encrypted })) });
  }));

  mcp.registerTool('get_secrets_overview', {
    description: 'Returns all Secrets Manager secrets: names, rotation status. Secret VALUES are never included.',
    inputSchema: z.object({}),
  }, logged('get_secrets_overview', async () => {
    const secrets = getSecretNodes(currentGraph);
    const secretFindings = currentFindings.filter((f) => (f.metadata as Record<string, unknown> | undefined)?.secretName);
    return toText({
      total: secrets.length, note: 'Secret values are never included in this response.',
      secrets: secrets.map((s) => ({
        name: s.name, provider: s.provider, rotationEnabled: s.rotationEnabled, rotationDays: s.rotationDays,
        findings: secretFindings.filter((f) => (f.metadata as Record<string, unknown>).secretName === s.name).map((f) => ({ severity: f.severity, issue: f.issue })),
      })),
    });
  }));

  mcp.registerTool('get_parameter_overview', {
    description: 'Returns all SSM Parameter Store parameters: names, types, tiers. Parameter VALUES are never included.',
    inputSchema: z.object({}),
  }, logged('get_parameter_overview', async () => {
    const parameters = getParameterNodes(currentGraph);
    return toText({
      total: parameters.length, note: 'Parameter values are never included in this response.',
      parameters: parameters.map((p) => ({ name: p.name, provider: p.provider, type: p.paramType, tier: p.tier })),
    });
  }));

  mcp.registerTool('get_lambda_overview', {
    description: 'Returns all Lambda functions: runtime, memory, timeout, env var key names (values never included).',
    inputSchema: z.object({}),
  }, logged('get_lambda_overview', async () => {
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
  }));

  mcp.registerTool('get_log_errors', {
    description: 'Returns recent error patterns from CloudWatch log groups. Returns pattern counts and frequencies — never raw log messages.',
    inputSchema: z.object({ logGroup: z.string().describe('Filter to a specific log group name (optional)').optional() }),
  }, logged('get_log_errors', async ({ logGroup: filterName }) => {
    const logGroups = getLogGroupNodes(currentGraph).filter((lg) => !filterName || lg.name.includes(filterName));
    return toText({
      note: 'Only error patterns and counts are returned — no raw log messages.',
      windowHours: 24,
      logGroups: logGroups.map((lg) => ({ name: lg.name, retentionDays: lg.retentionDays ?? 'never-expires', errorCount: lg.errorCount, topErrorPatterns: lg.topErrorPatterns })),
    });
  }));

  return mcp;
}

// ── Fastify server ────────────────────────────────────────────────────────────

export function createServer(port = 3000) {
  const fastify = Fastify({ logger: false });
  fastify.register(cors, { origin: true });

  const mcp = createMcpServer();

  fastify.get('/health', async () => ({
    status: 'ok', version,
    graphNodes: currentGraph.nodes.length,
    graphEdges: currentGraph.edges.length,
    findings: currentFindings.length,
  }));

  fastify.post('/mcp', async (request, reply) => {
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
