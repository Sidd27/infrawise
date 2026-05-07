import type { Analyzer, SystemGraph, Finding, GraphNode } from '@infrawise/shared';
import { getScanEdges } from '@infrawise/graph';

/**
 * Detects MySQL tables that are queried without any indexes defined.
 */
export class MissingMySQLIndexAnalyzer implements Analyzer {
  name = 'MissingMySQLIndexAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];

    const mysqlTables = graph.nodes.filter(
      (n): n is Extract<GraphNode, { type: 'table' }> =>
        n.type === 'table' && n.databaseType === 'mysql',
    );

    for (const table of mysqlTables) {
      const indexEdges = graph.edges.filter((e) => e.from === table.id && e.type === 'uses_index');
      const hasIndexes = indexEdges.length > 0;

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
          issue: `MySQL table "${table.name}" has no indexes but is queried by ${queryEdges.length} function(s)`,
          description: `Table "${table.name}" is accessed by functions (${callerFunctions}) but has no secondary indexes defined. Queries on non-primary-key columns will result in full table scans.`,
          recommendation:
            'Add indexes on columns used in WHERE clauses. Run EXPLAIN on slow queries. Consider composite indexes for multi-column filters.',
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
 * Detects full table scans on MySQL tables.
 */
export class MySQLFullTableScanAnalyzer implements Analyzer {
  name = 'MySQLFullTableScanAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    const scanEdges = getScanEdges(graph);

    const scannedTableIds = new Set<string>();
    for (const edge of scanEdges) {
      const targetNode = graph.nodes.find((n) => n.id === edge.to);
      if (targetNode?.type === 'table' && targetNode.databaseType === 'mysql') {
        scannedTableIds.add(targetNode.id);
      }
    }

    for (const tableId of scannedTableIds) {
      const tableNode = graph.nodes.find((n) => n.id === tableId) as Extract<
        GraphNode,
        { type: 'table' }
      >;
      if (!tableNode) continue;

      const tableScanEdges = scanEdges.filter((e) => e.to === tableId);
      const callerFunctions = tableScanEdges
        .map((e) => {
          const node = graph.nodes.find((n) => n.id === e.from);
          return node?.type === 'function' ? node.name : e.from;
        })
        .join(', ');

      findings.push({
        severity: 'high',
        issue: `Full table scan detected on MySQL table "${tableNode.name}"`,
        description: `The table "${tableNode.name}" is being scanned without a usable index, reading every row. This is expensive for large tables. Called from: ${callerFunctions || 'unknown'}`,
        recommendation:
          'Add an index on the column(s) used in the WHERE clause. Use EXPLAIN to verify the query plan uses the index after adding it.',
        metadata: {
          tableName: tableNode.name,
          scanCount: tableScanEdges.length,
          callerFunctions,
        },
      });
    }

    return findings;
  }
}
