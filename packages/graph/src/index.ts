import type {
  SystemGraph,
  GraphNode,
  GraphEdge,
  ExtractedOperation,
  DynamoTableMetadata,
  PostgresTableMetadata,
  MySQLTableMetadata,
  MongoCollectionMetadata,
} from '@infrawise/shared';

export function buildGraph(
  operations: ExtractedOperation[],
  dynamoMeta: DynamoTableMetadata[],
  postgresMeta: PostgresTableMetadata[],
  mysqlMeta: MySQLTableMetadata[] = [],
  mongoMeta: MongoCollectionMetadata[] = [],
): SystemGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  // Add table nodes from DynamoDB metadata
  for (const table of dynamoMeta) {
    const nodeId = `table:dynamo:${table.tableName}`;
    if (!nodeIds.has(nodeId)) {
      nodes.push({
        id: nodeId,
        type: 'table',
        name: table.tableName,
        databaseType: 'dynamodb',
      });
      nodeIds.add(nodeId);
    }

    // Add index nodes for each GSI
    for (const indexName of table.indexes) {
      const indexNodeId = `index:${table.tableName}:${indexName}`;
      if (!nodeIds.has(indexNodeId)) {
        nodes.push({ id: indexNodeId, type: 'index', name: indexName });
        nodeIds.add(indexNodeId);
      }
      // Edge: table uses_index
      edges.push({ from: nodeId, to: indexNodeId, type: 'uses_index' });
    }
  }

  // Add table nodes from PostgreSQL metadata
  for (const table of postgresMeta) {
    const nodeId = `table:postgres:${table.schema}.${table.table}`;
    if (!nodeIds.has(nodeId)) {
      nodes.push({
        id: nodeId,
        type: 'table',
        name: `${table.schema}.${table.table}`,
        databaseType: 'postgres',
      });
      nodeIds.add(nodeId);
    }

    // Add index nodes
    for (const indexName of table.indexes) {
      const indexNodeId = `index:${table.schema}.${table.table}:${indexName}`;
      if (!nodeIds.has(indexNodeId)) {
        nodes.push({ id: indexNodeId, type: 'index', name: indexName });
        nodeIds.add(indexNodeId);
      }
      edges.push({ from: nodeId, to: indexNodeId, type: 'uses_index' });
    }
  }

  // Add table nodes from MySQL metadata
  for (const table of mysqlMeta) {
    const nodeId = `table:mysql:${table.schema}.${table.table}`;
    if (!nodeIds.has(nodeId)) {
      nodes.push({
        id: nodeId,
        type: 'table',
        name: `${table.schema}.${table.table}`,
        databaseType: 'mysql',
      });
      nodeIds.add(nodeId);
    }

    // Add index nodes
    for (const indexName of table.indexes) {
      const indexNodeId = `index:${table.schema}.${table.table}:${indexName}`;
      if (!nodeIds.has(indexNodeId)) {
        nodes.push({ id: indexNodeId, type: 'index', name: indexName });
        nodeIds.add(indexNodeId);
      }
      edges.push({ from: nodeId, to: indexNodeId, type: 'uses_index' });
    }
  }

  // Add collection nodes from MongoDB metadata
  for (const coll of mongoMeta) {
    const nodeId = `table:mongodb:${coll.database}.${coll.collection}`;
    if (!nodeIds.has(nodeId)) {
      nodes.push({
        id: nodeId,
        type: 'table',
        name: `${coll.database}.${coll.collection}`,
        databaseType: 'mongodb',
      });
      nodeIds.add(nodeId);
    }

    // Add index nodes
    for (const idx of coll.indexes) {
      if (idx.name === '_id_') continue; // Skip default _id index
      const indexNodeId = `index:${coll.database}.${coll.collection}:${idx.name}`;
      if (!nodeIds.has(indexNodeId)) {
        nodes.push({ id: indexNodeId, type: 'index', name: idx.name });
        nodeIds.add(indexNodeId);
      }
      edges.push({ from: nodeId, to: indexNodeId, type: 'uses_index' });
    }
  }

  // Process extracted operations — add function nodes and edges
  for (const op of operations) {
    const funcNodeId = `function:${op.filePath}:${op.functionName}`;
    if (!nodeIds.has(funcNodeId)) {
      nodes.push({
        id: funcNodeId,
        type: 'function',
        name: op.functionName,
        file: op.filePath,
      });
      nodeIds.add(funcNodeId);
    }

    // Resolve target table node id
    let tableNodeId: string | undefined;
    if (op.databaseType === 'dynamodb') {
      tableNodeId = `table:dynamo:${op.target}`;
      // If the table isn't in metadata, still add it
      if (!nodeIds.has(tableNodeId)) {
        nodes.push({
          id: tableNodeId,
          type: 'table',
          name: op.target,
          databaseType: 'dynamodb',
        });
        nodeIds.add(tableNodeId);
      }
    } else if (op.databaseType === 'mysql') {
      const qualifiedTarget = op.target.includes('.') ? op.target : `default.${op.target}`;
      tableNodeId = `table:mysql:${qualifiedTarget}`;
      if (!nodeIds.has(tableNodeId)) {
        nodes.push({
          id: tableNodeId,
          type: 'table',
          name: qualifiedTarget,
          databaseType: 'mysql',
        });
        nodeIds.add(tableNodeId);
      }
    } else if (op.databaseType === 'mongodb') {
      const qualifiedTarget = op.target.includes('.') ? op.target : `default.${op.target}`;
      tableNodeId = `table:mongodb:${qualifiedTarget}`;
      if (!nodeIds.has(tableNodeId)) {
        nodes.push({
          id: tableNodeId,
          type: 'table',
          name: qualifiedTarget,
          databaseType: 'mongodb',
        });
        nodeIds.add(tableNodeId);
      }
    } else {
      // postgres — target might be "schema.table" or just "table"
      const qualifiedTarget = op.target.includes('.') ? op.target : `public.${op.target}`;
      tableNodeId = `table:postgres:${qualifiedTarget}`;
      if (!nodeIds.has(tableNodeId)) {
        const parts = qualifiedTarget.split('.');
        nodes.push({
          id: tableNodeId,
          type: 'table',
          name: qualifiedTarget,
          databaseType: 'postgres',
        });
        nodeIds.add(tableNodeId);
        // Also add a synthetic postgres meta entry if not already tracked
        if (!postgresMeta.find((t) => `${t.schema}.${t.table}` === qualifiedTarget)) {
          postgresMeta.push({
            schema: parts[0] ?? 'public',
            table: parts[1] ?? op.target,
            columns: [],
            indexes: [],
            primaryKeys: [],
          });
        }
      }
    }

    // Determine edge type based on operation
    const edgeType = resolveEdgeType(op.operationType);
    edges.push({ from: funcNodeId, to: tableNodeId, type: edgeType });
  }

  return { nodes, edges };
}

function resolveEdgeType(operationType: string): GraphEdge['type'] {
  const op = operationType.toLowerCase();
  if (op === 'scan' || op === 'scancommand') return 'scan';
  if (op === 'join' || op === 'joins') return 'joins';
  return 'query';
}

export function getTableNodes(graph: SystemGraph): Extract<GraphNode, { type: 'table' }>[] {
  return graph.nodes.filter((n): n is Extract<GraphNode, { type: 'table' }> => n.type === 'table');
}

export function getFunctionNodes(graph: SystemGraph): Extract<GraphNode, { type: 'function' }>[] {
  return graph.nodes.filter(
    (n): n is Extract<GraphNode, { type: 'function' }> => n.type === 'function',
  );
}

export function getIndexNodes(graph: SystemGraph): Extract<GraphNode, { type: 'index' }>[] {
  return graph.nodes.filter((n): n is Extract<GraphNode, { type: 'index' }> => n.type === 'index');
}

export function getEdgesForNode(graph: SystemGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}

export function getOutgoingEdges(graph: SystemGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

export function getIncomingEdges(graph: SystemGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.to === nodeId);
}

export function getScanEdges(graph: SystemGraph): GraphEdge[] {
  return graph.edges.filter((e) => e.type === 'scan');
}

export function getEdgeFrequency(graph: SystemGraph): Map<string, number> {
  const freq = new Map<string, number>();
  for (const edge of graph.edges) {
    const key = `${edge.from}->${edge.to}`;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return freq;
}

export type { SystemGraph, GraphNode, GraphEdge };
