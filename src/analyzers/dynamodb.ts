import type { Analyzer, SystemGraph, Finding, GraphNode } from '../types';
import { getScanEdges, getEdgeFrequency } from '../graph';

/**
 * Detects full table scans on DynamoDB tables.
 * A full scan without any filters is always a high-severity issue.
 */
export class FullTableScanAnalyzer implements Analyzer {
  name = 'FullTableScanAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    const scanEdges = getScanEdges(graph);

    // Find which tables are being scanned
    const scannedTableIds = new Set<string>();
    for (const edge of scanEdges) {
      // edge.to should be a table node
      const targetNode = graph.nodes.find((n) => n.id === edge.to);
      if (targetNode?.type === 'table' && targetNode.databaseType === 'dynamodb') {
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
        issue: `Full table scan detected on DynamoDB table "${tableNode.name}"`,
        description: `The table "${tableNode.name}" is being scanned without any filter, which reads every item. This is expensive and slow for large tables. Called from: ${callerFunctions || 'unknown'}`,
        recommendation:
          'Replace Scan with a Query operation using a partition key or GSI. If filtering is required on non-key attributes, add a Global Secondary Index (GSI).',
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

/**
 * Detects when a DynamoDB table is accessed without a GSI covering
 * the access pattern, which forces an expensive scan or inefficient query.
 */
export class MissingGSIAnalyzer implements Analyzer {
  name = 'MissingGSIAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Find all DynamoDB tables
    const dynamoTables = graph.nodes.filter(
      (n): n is Extract<GraphNode, { type: 'table' }> =>
        n.type === 'table' && n.databaseType === 'dynamodb',
    );

    for (const table of dynamoTables) {
      // Find edges coming INTO this table from function nodes
      const incomingEdges = graph.edges.filter((e) => e.to === table.id);
      const queryEdges = incomingEdges.filter((e) => e.type === 'query');

      // Check if this table has any GSIs
      const hasGSI = graph.edges.some(
        (e) => e.from === table.id && e.type === 'uses_index',
      );

      // If there are query operations but no GSI, flag as medium severity
      if (queryEdges.length > 0 && !hasGSI) {
        const callerFunctions = queryEdges
          .map((e) => {
            const node = graph.nodes.find((n) => n.id === e.from);
            return node?.type === 'function' ? node.name : e.from;
          })
          .join(', ');

        findings.push({
          severity: 'medium',
          issue: `DynamoDB table "${table.name}" has no GSIs but is queried by multiple functions`,
          description: `Table "${table.name}" is accessed by ${queryEdges.length} function(s) (${callerFunctions}) but has no Global Secondary Indexes defined. If queries filter on non-partition-key attributes, this will degrade to full scans.`,
          recommendation:
            'Analyze query access patterns and add GSIs for frequently filtered attributes. Consider using single-table design patterns with composite sort keys.',
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
 * Detects hot partition patterns — when the same table/partition
 * is accessed with very high frequency from many code paths.
 */
export class HotPartitionAnalyzer implements Analyzer {
  name = 'HotPartitionAnalyzer';

  private readonly hotThreshold: number;

  constructor(hotThreshold = 5) {
    this.hotThreshold = hotThreshold;
  }

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    const edgeFrequency = getEdgeFrequency(graph);

    // Count how many distinct functions access each DynamoDB table
    const tableAccessCount = new Map<string, Set<string>>();

    for (const edge of graph.edges) {
      const targetNode = graph.nodes.find((n) => n.id === edge.to);
      if (targetNode?.type !== 'table' || targetNode.databaseType !== 'dynamodb') continue;

      if (!tableAccessCount.has(edge.to)) {
        tableAccessCount.set(edge.to, new Set());
      }
      tableAccessCount.get(edge.to)!.add(edge.from);
    }

    for (const [tableId, accessors] of tableAccessCount) {
      if (accessors.size >= this.hotThreshold) {
        const tableNode = graph.nodes.find((n) => n.id === tableId) as Extract<
          GraphNode,
          { type: 'table' }
        >;
        if (!tableNode) continue;

        // Also check edge frequency for repeated access patterns
        let maxFreq = 0;
        for (const [key, freq] of edgeFrequency) {
          if (key.includes(tableId)) maxFreq = Math.max(maxFreq, freq);
        }

        findings.push({
          severity: 'medium',
          issue: `Potential hot partition detected on DynamoDB table "${tableNode.name}"`,
          description: `Table "${tableNode.name}" is accessed by ${accessors.size} distinct code paths, which may create hot partition issues at scale. High access concentration on the same partition key can throttle requests.`,
          recommendation:
            'Consider adding a random suffix or timestamp to partition keys (write sharding). Use DynamoDB DAX for read-heavy workloads. Distribute access patterns across multiple partition key values.',
          metadata: {
            tableName: tableNode.name,
            accessorCount: accessors.size,
            maxEdgeFrequency: maxFreq,
          },
        });
      }
    }

    return findings;
  }
}
