import type { Analyzer, SystemGraph, Finding, GraphNode } from '../types';
import { getScanEdges } from '../graph';

/**
 * Detects MongoDB collections that are queried without any secondary indexes.
 */
export class MissingMongoIndexAnalyzer implements Analyzer {
  name = 'MissingMongoIndexAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];

    const mongoCollections = graph.nodes.filter(
      (n): n is Extract<GraphNode, { type: 'table' }> =>
        n.type === 'table' && n.databaseType === 'mongodb',
    );

    for (const coll of mongoCollections) {
      const indexEdges = graph.edges.filter((e) => e.from === coll.id && e.type === 'uses_index');
      const hasIndexes = indexEdges.length > 0;

      const queryEdges = graph.edges.filter(
        (e) => e.to === coll.id && (e.type === 'query' || e.type === 'scan'),
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
          issue: `MongoDB collection "${coll.name}" has no indexes but is queried by ${queryEdges.length} function(s)`,
          description: `Collection "${coll.name}" is accessed by functions (${callerFunctions}) but has no secondary indexes defined. Queries on non-_id fields will result in full collection scans.`,
          recommendation:
            'Add indexes using db.collection.createIndex({ field: 1 }) for frequently queried fields. Use explain("executionStats") to verify query plan.',
          metadata: {
            collectionName: coll.name,
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
 * Detects collection scan operations on MongoDB collections.
 */
export class MongoCollectionScanAnalyzer implements Analyzer {
  name = 'MongoCollectionScanAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    const scanEdges = getScanEdges(graph);

    const scannedCollIds = new Set<string>();
    for (const edge of scanEdges) {
      const targetNode = graph.nodes.find((n) => n.id === edge.to);
      if (targetNode?.type === 'table' && targetNode.databaseType === 'mongodb') {
        scannedCollIds.add(targetNode.id);
      }
    }

    for (const collId of scannedCollIds) {
      const collNode = graph.nodes.find((n) => n.id === collId) as Extract<
        GraphNode,
        { type: 'table' }
      >;
      if (!collNode) continue;

      const collScanEdges = scanEdges.filter((e) => e.to === collId);
      const callerFunctions = collScanEdges
        .map((e) => {
          const node = graph.nodes.find((n) => n.id === e.from);
          return node?.type === 'function' ? node.name : e.from;
        })
        .join(', ');

      findings.push({
        severity: 'high',
        issue: `Collection scan detected on MongoDB collection "${collNode.name}"`,
        description: `Collection "${collNode.name}" is being scanned without an index, reading every document. This is very expensive for large collections. Called from: ${callerFunctions || 'unknown'}`,
        recommendation:
          'Add an index on the field(s) used as query predicates. Use db.collection.createIndex({ field: 1 }) and verify with explain("executionStats").',
        metadata: {
          collectionName: collNode.name,
          scanCount: collScanEdges.length,
          callerFunctions,
        },
      });
    }

    return findings;
  }
}
