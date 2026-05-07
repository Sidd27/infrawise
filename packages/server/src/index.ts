import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { SystemGraph, Finding, MCPToolCall, MCPToolResult } from '@infrawise/shared';
import { logger } from '@infrawise/core';
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
} from '@infrawise/graph';

let currentGraph: SystemGraph = { nodes: [], edges: [] };
let currentFindings: Finding[] = [];

export function setGraphState(graph: SystemGraph, findings: Finding[]): void {
  currentGraph = graph;
  currentFindings = findings;
}

export function createServer(port = 3000) {
  const fastify = Fastify({ logger: false });
  fastify.register(cors, { origin: true });

  fastify.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    graphNodes: currentGraph.nodes.length,
    graphEdges: currentGraph.edges.length,
    findings: currentFindings.length,
  }));

  fastify.post<{ Body: MCPToolCall }>('/mcp', async (request, reply) => {
    const { tool, input } = request.body;
    if (!tool) {
      reply.status(400);
      return { success: false, error: 'Missing "tool" field' } satisfies MCPToolResult;
    }
    logger.info(`MCP tool call: ${tool}`);
    try {
      const result = await handleToolCall(tool, input ?? {});
      return { success: true, data: result } satisfies MCPToolResult;
    } catch (err) {
      logger.error(`MCP tool "${tool}" failed: ${err instanceof Error ? err.message : String(err)}`);
      reply.status(500);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' } satisfies MCPToolResult;
    }
  });

  fastify.get('/mcp/tools', async () => ({
    tools: [
      // ── Overview ──────────────────────────────────────────────────────────
      {
        name: 'get_infra_overview',
        description: 'Returns a complete snapshot of all infrastructure: databases, queues, topics, secrets, parameters, log groups, lambdas, and all findings. Start here for a full picture.',
        input: {},
      },
      {
        name: 'get_graph_summary',
        description: 'Returns the full infrastructure graph (all nodes and edges) plus findings summary.',
        input: {},
      },
      // ── Code analysis ────────────────────────────────────────────────────
      {
        name: 'analyze_function',
        description: 'Analyze a specific function for all infrastructure issues: DB queries, queue publishing, secret access, etc.',
        input: { function: 'string — function name' },
      },
      // ── Database helpers ─────────────────────────────────────────────────
      {
        name: 'suggest_gsi',
        description: 'Get GSI suggestions for a DynamoDB table and attribute',
        input: { table: 'string', attribute: 'string' },
      },
      {
        name: 'postgres_index_suggestions',
        description: 'Get PostgreSQL index suggestions for a table column',
        input: { table: 'string', column: 'string' },
      },
      {
        name: 'suggest_mongo_index',
        description: 'Get index suggestions for a MongoDB collection field',
        input: { collection: 'string', field: 'string' },
      },
      {
        name: 'mysql_index_suggestions',
        description: 'Get MySQL index suggestions for a table column',
        input: { table: 'string', column: 'string' },
      },
      // ── Messaging ────────────────────────────────────────────────────────
      {
        name: 'get_queue_details',
        description: 'Returns all SQS queues with DLQ status, encryption, message counts, and retention. Use to audit messaging infrastructure.',
        input: {},
      },
      {
        name: 'get_topic_details',
        description: 'Returns all SNS topics with subscription counts and protocols.',
        input: {},
      },
      // ── Secrets & config ─────────────────────────────────────────────────
      {
        name: 'get_secrets_overview',
        description: 'Returns all Secrets Manager secrets: names, rotation status, last accessed. Secret VALUES are never included.',
        input: {},
      },
      {
        name: 'get_parameter_overview',
        description: 'Returns all SSM Parameter Store parameters: names, types, tiers. Parameter VALUES are never included.',
        input: {},
      },
      // ── Compute ──────────────────────────────────────────────────────────
      {
        name: 'get_lambda_overview',
        description: 'Returns all Lambda functions: runtime, memory, timeout, env var key names (values never included).',
        input: {},
      },
      // ── Observability ────────────────────────────────────────────────────
      {
        name: 'get_log_errors',
        description: 'Returns recent error patterns from CloudWatch log groups. Returns pattern counts and frequencies — never raw log messages. Safe for context.',
        input: {
          logGroup: 'string (optional) — filter to a specific log group name',
        },
      },
    ],
  }));

  return { fastify, start: () => startServer(fastify, port) };
}

async function handleToolCall(tool: string, input: Record<string, unknown>): Promise<unknown> {
  switch (tool) {

    // ── Overview ─────────────────────────────────────────────────────────────

    case 'get_infra_overview': {
      const tables = getTableNodes(currentGraph);
      const queues = getQueueNodes(currentGraph);
      const topics = getTopicNodes(currentGraph);
      const secrets = getSecretNodes(currentGraph);
      const parameters = getParameterNodes(currentGraph);
      const logGroups = getLogGroupNodes(currentGraph);
      const lambdas = getLambdaNodes(currentGraph);
      const functions = getFunctionNodes(currentGraph);

      return {
        summary: {
          tables: tables.length,
          functions: functions.length,
          queues: queues.length,
          topics: topics.length,
          secrets: secrets.length,
          parameters: parameters.length,
          logGroups: logGroups.length,
          lambdas: lambdas.length,
          totalNodes: currentGraph.nodes.length,
          totalEdges: currentGraph.edges.length,
          findings: {
            total: currentFindings.length,
            high: currentFindings.filter((f) => f.severity === 'high').length,
            medium: currentFindings.filter((f) => f.severity === 'medium').length,
            low: currentFindings.filter((f) => f.severity === 'low').length,
          },
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
        highFindings: currentFindings.filter((f) => f.severity === 'high').map((f) => ({
          issue: f.issue,
          recommendation: f.recommendation,
        })),
      };
    }

    case 'get_graph_summary': {
      return {
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
          totalFindings: currentFindings.length,
          highSeverity: currentFindings.filter((f) => f.severity === 'high').length,
          mediumSeverity: currentFindings.filter((f) => f.severity === 'medium').length,
          lowSeverity: currentFindings.filter((f) => f.severity === 'low').length,
        },
      };
    }

    // ── Code analysis ──────────────────────────────────────────────────────────

    case 'analyze_function': {
      const functionName = String(input.function ?? '');
      if (!functionName) throw new Error('Missing input.function');

      const funcNode = currentGraph.nodes.find((n) => n.type === 'function' && n.name === functionName);

      if (!funcNode) {
        return {
          function: functionName,
          found: false,
          issues: [],
          recommendations: [`Function "${functionName}" not found in the analyzed codebase.`],
        };
      }

      const outEdges = getOutgoingEdges(currentGraph, funcNode.id);
      const relatedFindings = currentFindings.filter((f) => {
        const meta = f.metadata as Record<string, unknown> | undefined;
        return meta?.functionName === functionName || String(meta?.callerFunctions ?? '').includes(functionName);
      });

      return {
        function: functionName,
        found: true,
        file: funcNode.type === 'function' ? funcNode.file : undefined,
        accesses: outEdges.map((e) => {
          const target = currentGraph.nodes.find((n) => n.id === e.to);
          return {
            targetId: e.to,
            edgeType: e.type,
            targetName: target && 'name' in target ? target.name : e.to,
            targetType: target?.type,
          };
        }),
        issues: relatedFindings.map((f) => ({
          severity: f.severity,
          issue: f.issue,
          description: f.description,
        })),
        recommendations: [...new Set(relatedFindings.map((f) => f.recommendation))],
      };
    }

    // ── Database helpers ───────────────────────────────────────────────────────

    case 'suggest_gsi': {
      const tableName = String(input.table ?? '');
      const attribute = String(input.attribute ?? '');
      if (!tableName || !attribute) throw new Error('Missing input.table or input.attribute');

      const tableNode = currentGraph.nodes.find(
        (n) => n.type === 'table' && n.databaseType === 'dynamodb' && 'name' in n && n.name === tableName,
      );
      const sanitizedAttr = attribute.replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `${tableName}-${sanitizedAttr}-index`;

      return {
        table: tableName,
        attribute,
        found: !!tableNode,
        index: { name: indexName, partitionKey: attribute, projectionType: 'ALL', billingMode: 'PAY_PER_REQUEST' },
        rationale: `A GSI on "${attribute}" allows Query instead of Scan when filtering by this attribute.`,
        recommendation: `Add GSI "${indexName}" with partition key "${attribute}" to your IaC definition.`,
      };
    }

    case 'postgres_index_suggestions': {
      const tableName = String(input.table ?? '');
      const column = String(input.column ?? '');
      if (!tableName || !column) throw new Error('Missing input.table or input.column');

      const sanitizedCol = column.replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;

      return {
        table: tableName,
        column,
        recommendation: `CREATE INDEX CONCURRENTLY ${indexName} ON ${tableName} (${column});`,
        rationale: `An index on "${column}" eliminates sequential scans when filtering on this column.`,
        notes: [
          'Use CONCURRENTLY to avoid locking the table',
          'Run ANALYZE after creation',
          `Partial index: CREATE INDEX CONCURRENTLY ${indexName}_partial ON ${tableName} (${column}) WHERE ${column} IS NOT NULL;`,
        ],
      };
    }

    case 'suggest_mongo_index': {
      const collection = String(input.collection ?? '');
      const field = String(input.field ?? '');
      if (!collection || !field) throw new Error('Missing input.collection or input.field');

      return {
        collection,
        field,
        recommendation: `db.${collection}.createIndex({ ${field}: 1 })`,
        rationale: `An index on "${field}" eliminates full collection scans when filtering on this field.`,
        notes: [
          `Compound: db.${collection}.createIndex({ ${field}: 1, otherField: 1 })`,
          `Text: db.${collection}.createIndex({ ${field}: "text" })`,
          `Verify: db.${collection}.explain("executionStats").find({ ${field}: value })`,
        ],
      };
    }

    case 'mysql_index_suggestions': {
      const tableName = String(input.table ?? '');
      const column = String(input.column ?? '');
      if (!tableName || !column) throw new Error('Missing input.table or input.column');

      const sanitizedCol = column.replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;

      return {
        table: tableName,
        column,
        recommendation: `ALTER TABLE ${tableName} ADD INDEX ${indexName} (${column});`,
        rationale: `An index on "${column}" eliminates full table scans when filtering on this column.`,
        notes: [
          'MySQL InnoDB adds indexes online (no full lock for 5.6+)',
          `EXPLAIN SELECT ... to verify after adding`,
          `Composite: ALTER TABLE ${tableName} ADD INDEX idx_composite (${column}, other_column);`,
        ],
      };
    }

    // ── Messaging ─────────────────────────────────────────────────────────────

    case 'get_queue_details': {
      const queues = getQueueNodes(currentGraph);
      const queueFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.queueName,
      );

      return {
        total: queues.length,
        queues: queues.map((q) => ({
          name: q.name,
          provider: q.provider,
          hasDLQ: q.hasDLQ,
          encrypted: q.encrypted,
          approximateMessages: q.approximateMessages,
          retentionDays: q.retentionDays,
          findings: queueFindings
            .filter((f) => (f.metadata as Record<string, unknown>).queueName === q.name)
            .map((f) => ({ severity: f.severity, issue: f.issue })),
        })),
      };
    }

    case 'get_topic_details': {
      const topics = getTopicNodes(currentGraph);
      return {
        total: topics.length,
        topics: topics.map((t) => ({
          name: t.name,
          provider: t.provider,
          subscriptionCount: t.subscriptionCount,
          encrypted: t.encrypted,
        })),
      };
    }

    // ── Secrets & config ──────────────────────────────────────────────────────

    case 'get_secrets_overview': {
      const secrets = getSecretNodes(currentGraph);
      const secretFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.secretName,
      );

      return {
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
      };
    }

    case 'get_parameter_overview': {
      const parameters = getParameterNodes(currentGraph);
      return {
        total: parameters.length,
        note: 'Parameter values are never included in this response.',
        parameters: parameters.map((p) => ({
          name: p.name,
          provider: p.provider,
          type: p.paramType,
          tier: p.tier,
        })),
      };
    }

    // ── Compute ───────────────────────────────────────────────────────────────

    case 'get_lambda_overview': {
      const lambdas = getLambdaNodes(currentGraph);
      const lambdaFindings = currentFindings.filter(
        (f) => (f.metadata as Record<string, unknown> | undefined)?.functionName,
      );

      return {
        total: lambdas.length,
        note: 'Environment variable values are never included.',
        lambdas: lambdas.map((l) => ({
          name: l.name,
          runtime: l.runtime,
          memoryMB: l.memoryMB,
          timeoutSec: l.timeoutSec,
          envVarCount: l.envVarKeys?.length ?? 0,
          envVarKeys: l.envVarKeys,
          findings: lambdaFindings
            .filter((f) => (f.metadata as Record<string, unknown>).functionName === l.name)
            .map((f) => ({ severity: f.severity, issue: f.issue })),
        })),
      };
    }

    // ── Observability ─────────────────────────────────────────────────────────

    case 'get_log_errors': {
      const filterName = input.logGroup ? String(input.logGroup) : undefined;
      const logGroups = getLogGroupNodes(currentGraph).filter(
        (lg) => !filterName || lg.name.includes(filterName),
      );

      return {
        note: 'Only error patterns and counts are returned — no raw log messages.',
        windowHours: 24,
        logGroups: logGroups.map((lg) => ({
          name: lg.name,
          retentionDays: lg.retentionDays ?? 'never-expires',
          errorCount: lg.errorCount,
          topErrorPatterns: lg.topErrorPatterns,
        })),
      };
    }

    default:
      throw new Error(
        `Unknown tool: "${tool}". Call GET /mcp/tools for the list of available tools.`,
      );
  }
}

async function startServer(fastify: ReturnType<typeof Fastify>, port: number): Promise<void> {
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    logger.info(`Infrawise MCP server running at http://localhost:${port}`);
  } catch (err) {
    logger.error(`Failed to start server: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export { currentGraph, currentFindings };
