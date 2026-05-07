import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { SystemGraph, Finding, MCPToolCall, MCPToolResult } from '@infrawise/shared';
import { logger } from '@infrawise/core';
import {
  getTableNodes,
  getFunctionNodes,
  getScanEdges,
  getOutgoingEdges,
} from '@infrawise/graph';
import { runAllAnalyzers } from '@infrawise/analyzers';

// In-memory state — populated by the CLI before starting server
let currentGraph: SystemGraph = { nodes: [], edges: [] };
let currentFindings: Finding[] = [];

export function setGraphState(graph: SystemGraph, findings: Finding[]): void {
  currentGraph = graph;
  currentFindings = findings;
}

export function createServer(port = 3000) {
  const fastify = Fastify({
    logger: false, // We use pino directly
  });

  fastify.register(cors, { origin: true });

  // Health check
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      version: '0.1.0',
      graphNodes: currentGraph.nodes.length,
      graphEdges: currentGraph.edges.length,
      findings: currentFindings.length,
    };
  });

  // MCP endpoint
  fastify.post<{ Body: MCPToolCall }>('/mcp', async (request, reply) => {
    const { tool, input } = request.body;

    if (!tool) {
      reply.status(400);
      return { success: false, error: 'Missing "tool" field in request body' } satisfies MCPToolResult;
    }

    logger.info(`MCP tool call: ${tool}`);

    try {
      const result = await handleToolCall(tool, input ?? {});
      return { success: true, data: result } satisfies MCPToolResult;
    } catch (err) {
      logger.error(`MCP tool "${tool}" failed: ${err instanceof Error ? err.message : String(err)}`);
      reply.status(500);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      } satisfies MCPToolResult;
    }
  });

  // List available tools
  fastify.get('/mcp/tools', async () => {
    return {
      tools: [
        {
          name: 'get_graph_summary',
          description: 'Returns the full infrastructure graph with all findings',
          input: {},
        },
        {
          name: 'analyze_function',
          description: 'Analyze a specific function for database issues',
          input: { function: 'string — function name to analyze' },
        },
        {
          name: 'suggest_gsi',
          description: 'Get GSI suggestions for a DynamoDB table and attribute',
          input: {
            table: 'string — DynamoDB table name',
            attribute: 'string — attribute to index',
          },
        },
        {
          name: 'postgres_index_suggestions',
          description: 'Get PostgreSQL index suggestions for a table column',
          input: {
            table: 'string — PostgreSQL table name',
            column: 'string — column to analyze',
          },
        },
        {
          name: 'suggest_mongo_index',
          description: 'Get index suggestions for a MongoDB collection field',
          input: {
            collection: 'string — MongoDB collection name',
            field: 'string — field to index',
          },
        },
        {
          name: 'mysql_index_suggestions',
          description: 'Get MySQL index suggestions for a table column',
          input: {
            table: 'string — MySQL table name',
            column: 'string — column to analyze',
          },
        },
      ],
    };
  });

  return { fastify, start: () => startServer(fastify, port) };
}

async function handleToolCall(tool: string, input: Record<string, unknown>): Promise<unknown> {
  switch (tool) {
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
          scans: getScanEdges(currentGraph).length,
          totalFindings: currentFindings.length,
          highSeverity: currentFindings.filter((f) => f.severity === 'high').length,
          mediumSeverity: currentFindings.filter((f) => f.severity === 'medium').length,
          lowSeverity: currentFindings.filter((f) => f.severity === 'low').length,
        },
      };
    }

    case 'analyze_function': {
      const functionName = String(input.function ?? '');
      if (!functionName) {
        throw new Error('Missing input.function');
      }

      const funcNode = currentGraph.nodes.find(
        (n) => n.type === 'function' && n.name === functionName,
      );

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
        return meta?.functionName === functionName || meta?.callerFunctions?.toString().includes(functionName);
      });

      const issues = relatedFindings.map((f) => ({
        severity: f.severity,
        issue: f.issue,
        description: f.description,
      }));

      const recommendations = relatedFindings.map((f) => f.recommendation);
      const uniqueRecs = [...new Set(recommendations)];

      return {
        function: functionName,
        found: true,
        file: funcNode.type === 'function' ? funcNode.file : undefined,
        accessedTables: outEdges.map((e) => {
          const target = currentGraph.nodes.find((n) => n.id === e.to);
          return { tableId: e.to, edgeType: e.type, tableName: target && 'name' in target ? target.name : e.to };
        }),
        issues,
        recommendations: uniqueRecs,
      };
    }

    case 'suggest_gsi': {
      const tableName = String(input.table ?? '');
      const attribute = String(input.attribute ?? '');

      if (!tableName || !attribute) {
        throw new Error('Missing input.table or input.attribute');
      }

      const tableNode = currentGraph.nodes.find(
        (n) => n.type === 'table' && n.databaseType === 'dynamodb' && 'name' in n && n.name === tableName,
      );

      if (!tableNode) {
        return {
          table: tableName,
          attribute,
          found: false,
          message: `DynamoDB table "${tableName}" not found in analyzed graph`,
        };
      }

      const sanitizedAttr = attribute.replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `${tableName}-${sanitizedAttr}-index`;

      return {
        table: tableName,
        attribute,
        index: {
          name: indexName,
          partitionKey: attribute,
          projectionType: 'ALL',
          billingMode: 'PAY_PER_REQUEST',
        },
        rationale: `Adding a GSI with partition key "${attribute}" will allow efficient Query operations instead of full table Scans when filtering by this attribute.`,
        estimatedCost: 'Approximately double the storage cost for the projected attributes.',
        recommendation: `Add the following GSI to your CloudFormation/Terraform definition:\n\nGSI Name: ${indexName}\nPartition Key: ${attribute}\nSort Key: (optional, add for range queries)\nProjection: ALL`,
      };
    }

    case 'postgres_index_suggestions': {
      const tableName = String(input.table ?? '');
      const column = String(input.column ?? '');

      if (!tableName || !column) {
        throw new Error('Missing input.table or input.column');
      }

      const tableNode = currentGraph.nodes.find(
        (n) =>
          n.type === 'table' &&
          n.databaseType === 'postgres' &&
          'name' in n &&
          (n.name === tableName || n.name.endsWith(`.${tableName}`)),
      );

      const sanitizedCol = column.replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;

      return {
        table: tableName,
        column,
        found: !!tableNode,
        recommendation: `CREATE INDEX CONCURRENTLY ${indexName} ON ${tableName} (${column});`,
        rationale: `An index on column "${column}" of table "${tableName}" will eliminate sequential scans when filtering on this column.`,
        notes: [
          'Use CONCURRENTLY to avoid locking the table during index creation',
          'Consider a partial index if the column has high cardinality and you commonly filter on specific values',
          'Run ANALYZE after creating the index to update statistics',
          `Example partial index: CREATE INDEX CONCURRENTLY ${indexName}_partial ON ${tableName} (${column}) WHERE ${column} IS NOT NULL;`,
        ],
      };
    }

    case 'suggest_mongo_index': {
      const collection = String(input.collection ?? '');
      const field = String(input.field ?? '');

      if (!collection || !field) {
        throw new Error('Missing input.collection or input.field');
      }

      const sanitizedField = field.replace(/[^a-zA-Z0-9_.]/g, '_');

      return {
        collection,
        field,
        recommendation: `db.${collection}.createIndex({ ${field}: 1 })`,
        rationale: `An index on field "${field}" of collection "${collection}" will eliminate full collection scans when filtering on this field.`,
        notes: [
          'Use { background: true } in MongoDB < 4.2 to avoid blocking reads during index creation',
          `For compound queries, consider a compound index: db.${collection}.createIndex({ ${field}: 1, otherField: 1 })`,
          `For text search, use a text index: db.${collection}.createIndex({ ${sanitizedField}: "text" })`,
          `Run db.${collection}.explain("executionStats").find({ ${field}: value }) to verify the index is used`,
        ],
      };
    }

    case 'mysql_index_suggestions': {
      const tableName = String(input.table ?? '');
      const column = String(input.column ?? '');

      if (!tableName || !column) {
        throw new Error('Missing input.table or input.column');
      }

      const sanitizedCol = column.replace(/[^a-zA-Z0-9_]/g, '_');
      const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
      const indexName = `idx_${sanitizedTable}_${sanitizedCol}`;

      const tableNode = currentGraph.nodes.find(
        (n) =>
          n.type === 'table' &&
          n.databaseType === 'mysql' &&
          'name' in n &&
          (n.name === tableName || n.name.endsWith(`.${tableName}`)),
      );

      return {
        table: tableName,
        column,
        found: !!tableNode,
        recommendation: `ALTER TABLE ${tableName} ADD INDEX ${indexName} (${column});`,
        rationale: `An index on column "${column}" of table "${tableName}" will eliminate full table scans when filtering on this column.`,
        notes: [
          'MySQL adds indexes online (no full table lock for InnoDB with MySQL 5.6+)',
          `Consider a composite index if you filter on multiple columns together`,
          `Use EXPLAIN SELECT ... to verify the index is used after adding it`,
          `Example composite: ALTER TABLE ${tableName} ADD INDEX idx_${sanitizedTable}_composite (${column}, other_column);`,
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: "${tool}". Available tools: get_graph_summary, analyze_function, suggest_gsi, postgres_index_suggestions, suggest_mongo_index, mysql_index_suggestions`);
  }
}

async function startServer(fastify: ReturnType<typeof Fastify>, port: number): Promise<void> {
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    logger.info(`Infrawise MCP server running at http://localhost:${port}`);
    logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
    logger.info(`Available tools: http://localhost:${port}/mcp/tools`);
  } catch (err) {
    logger.error(`Failed to start server: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export { currentGraph, currentFindings };
