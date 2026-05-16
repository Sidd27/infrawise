import type { Analyzer, SystemGraph, Finding, GraphNode } from '../types.js';

/**
 * Detects PostgreSQL table columns that are used in WHERE patterns
 * but don't have a corresponding index.
 */
export class MissingIndexAnalyzer implements Analyzer {
  name = 'MissingIndexAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];

    const postgresTables = graph.nodes.filter(
      (n): n is Extract<GraphNode, { type: 'table' }> =>
        n.type === 'table' && n.databaseType === 'postgres',
    );

    for (const table of postgresTables) {
      // Find indexes for this table via uses_index edges
      const indexEdges = graph.edges.filter((e) => e.from === table.id && e.type === 'uses_index');
      const hasIndexes = indexEdges.length > 0;

      // Find all query operations targeting this table
      const queryEdges = graph.edges.filter(
        (e) => e.to === table.id && (e.type === 'query' || e.type === 'scan'),
      );

      if (queryEdges.length > 0 && !hasIndexes) {
        const callerFunctions = queryEdges
          .map((e) => {
            const node = graph.nodes.find((n) => n.id === e.from);
            return node?.type === 'function' ? node.name : e.from;
          })
          .join(', ');

        findings.push({
          severity: 'medium',
          issue: `PostgreSQL table "${table.name}" has no indexes but is queried by ${queryEdges.length} function(s)`,
          description: `Table "${table.name}" is accessed by functions (${callerFunctions}) but has no secondary indexes defined. Queries on non-primary-key columns will result in sequential scans.`,
          recommendation:
            'Add indexes on columns used in WHERE clauses. Use EXPLAIN ANALYZE to identify slow queries. Consider composite indexes for multi-column filters.',
          metadata: {
            tableName: table.name,
            queryCount: queryEdges.length,
            callerFunctions,
          },
        });
      }
    }

    return findings;
  }
}

/**
 * Detects N+1 query patterns — same function making multiple queries
 * to the same table inside what is likely a loop.
 */
export class NplusOneAnalyzer implements Analyzer {
  name = 'NplusOneAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Group edges by function node -> table node
    const functionTableAccess = new Map<string, Map<string, number>>();

    for (const edge of graph.edges) {
      if (edge.type !== 'query') continue;

      const fromNode = graph.nodes.find((n) => n.id === edge.from);
      const toNode = graph.nodes.find((n) => n.id === edge.to);

      if (fromNode?.type !== 'function' || toNode?.type !== 'table') continue;
      if (toNode.databaseType !== 'postgres') continue;

      let tableAccess = functionTableAccess.get(edge.from);
      if (!tableAccess) {
        tableAccess = new Map();
        functionTableAccess.set(edge.from, tableAccess);
      }
      tableAccess.set(edge.to, (tableAccess.get(edge.to) ?? 0) + 1);
    }

    // Flag functions that access the same table more than once
    for (const [funcId, tableAccess] of functionTableAccess) {
      for (const [tableId, count] of tableAccess) {
        if (count >= 2) {
          const funcNode = graph.nodes.find((n) => n.id === funcId) as Extract<
            GraphNode,
            { type: 'function' }
          >;
          const tableNode = graph.nodes.find((n) => n.id === tableId) as Extract<
            GraphNode,
            { type: 'table' }
          >;
          if (!funcNode || !tableNode) continue;

          findings.push({
            severity: 'high',
            issue: `Potential N+1 query pattern in function "${funcNode.name}"`,
            description: `Function "${funcNode.name}" in ${funcNode.file} appears to query table "${tableNode.name}" ${count} time(s), suggesting a potential N+1 query pattern. This can lead to exponential database load when called in a loop.`,
            recommendation:
              'Batch multiple queries into a single query using IN clauses, JOIN operations, or DataLoader patterns. Consider using a bulk-fetch approach and filtering in application code.',
            metadata: {
              functionName: funcNode.name,
              filePath: funcNode.file,
              tableName: tableNode.name,
              queryCount: count,
            },
          });
        }
      }
    }

    return findings;
  }
}

/**
 * Detects SELECT * usage patterns which read all columns even when
 * only a subset is needed, wasting I/O and memory.
 */
export class LargeSelectAnalyzer implements Analyzer {
  name = 'LargeSelectAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Find query nodes that represent SELECT * patterns
    const queryNodes = graph.nodes.filter(
      (n): n is Extract<GraphNode, { type: 'query' }> => n.type === 'query',
    );

    for (const queryNode of queryNodes) {
      if (queryNode.operation.toLowerCase().includes('select *') ||
          queryNode.operation.toLowerCase().includes('select_all')) {
        findings.push({
          severity: 'low',
          issue: `SELECT * usage detected in query "${queryNode.operation}"`,
          description:
            'Using SELECT * reads all columns from the table, which can be expensive for wide tables. It also prevents index-only scans and increases network transfer.',
          recommendation:
            'Specify only the columns you need. For frequently accessed subsets of columns, consider creating a covering index that includes those columns.',
          metadata: {
            operation: queryNode.operation,
          },
        });
      }
    }

    // Also look for edges from functions to postgres tables with a high number of scan operations
    const postgresTables = graph.nodes.filter(
      (n): n is Extract<GraphNode, { type: 'table' }> =>
        n.type === 'table' && n.databaseType === 'postgres',
    );

    for (const table of postgresTables) {
      const scanEdges = graph.edges.filter((e) => e.to === table.id && e.type === 'scan');
      if (scanEdges.length > 0) {
        const callerFunctions = scanEdges
          .map((e) => {
            const node = graph.nodes.find((n) => n.id === e.from);
            return node?.type === 'function' ? node.name : e.from;
          })
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join(', ');

        findings.push({
          severity: 'medium',
          issue: `Sequential scan detected on PostgreSQL table "${table.name}"`,
          description: `Table "${table.name}" is accessed via sequential scan by ${scanEdges.length} operation(s) from: ${callerFunctions}. Sequential scans read the entire table and are very slow on large tables.`,
          recommendation:
            'Add appropriate indexes to support the WHERE conditions in these queries. Run EXPLAIN ANALYZE to understand the query plan. Consider partial indexes for filtered queries.',
          metadata: {
            tableName: table.name,
            scanCount: scanEdges.length,
            callerFunctions,
          },
        });
      }
    }

    return findings;
  }
}
