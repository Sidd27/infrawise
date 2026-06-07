import type {
  SystemGraph,
  GraphNode,
  GraphEdge,
  ExtractedOperation,
  DynamoTableMetadata,
  PostgresTableMetadata,
  MySQLTableMetadata,
  MongoCollectionMetadata,
  ServicesMeta,
  LambdaTrigger,
} from '../types.js';

export function buildGraph(
  operations: ExtractedOperation[],
  dynamoMeta: DynamoTableMetadata[],
  postgresMeta: PostgresTableMetadata[],
  mysqlMeta: MySQLTableMetadata[] = [],
  mongoMeta: MongoCollectionMetadata[] = [],
  servicesMeta: ServicesMeta = {},
): SystemGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const nodeMap = new Map<string, GraphNode>();

  function addNode(node: GraphNode): void {
    if (!nodeIds.has(node.id)) {
      nodes.push(node);
      nodeIds.add(node.id);
      nodeMap.set(node.id, node);
    }
  }

  // ── Database tables ──────────────────────────────────────────────────────

  for (const table of dynamoMeta) {
    const nodeId = `table:dynamo:${table.tableName}`;
    addNode({ id: nodeId, type: 'table', name: table.tableName, databaseType: 'dynamodb' });
    for (const indexName of table.indexes) {
      const indexNodeId = `index:${table.tableName}:${indexName}`;
      addNode({ id: indexNodeId, type: 'index', name: indexName });
      edges.push({ from: nodeId, to: indexNodeId, type: 'uses_index' });
    }
  }

  for (const table of postgresMeta) {
    const nodeId = `table:postgres:${table.schema}.${table.table}`;
    addNode({
      id: nodeId,
      type: 'table',
      name: `${table.schema}.${table.table}`,
      databaseType: 'postgres',
    });
    for (const indexName of table.indexes) {
      const indexNodeId = `index:${table.schema}.${table.table}:${indexName}`;
      addNode({ id: indexNodeId, type: 'index', name: indexName });
      edges.push({ from: nodeId, to: indexNodeId, type: 'uses_index' });
    }
  }

  for (const table of mysqlMeta) {
    const nodeId = `table:mysql:${table.schema}.${table.table}`;
    addNode({
      id: nodeId,
      type: 'table',
      name: `${table.schema}.${table.table}`,
      databaseType: 'mysql',
    });
    for (const indexName of table.indexes) {
      const indexNodeId = `index:${table.schema}.${table.table}:${indexName}`;
      addNode({ id: indexNodeId, type: 'index', name: indexName });
      edges.push({ from: nodeId, to: indexNodeId, type: 'uses_index' });
    }
  }

  for (const coll of mongoMeta) {
    const nodeId = `table:mongodb:${coll.database}.${coll.collection}`;
    addNode({
      id: nodeId,
      type: 'table',
      name: `${coll.database}.${coll.collection}`,
      databaseType: 'mongodb',
    });
    for (const idx of coll.indexes) {
      if (idx.name === '_id_') continue;
      const indexNodeId = `index:${coll.database}.${coll.collection}:${idx.name}`;
      addNode({ id: indexNodeId, type: 'index', name: idx.name });
      edges.push({ from: nodeId, to: indexNodeId, type: 'uses_index' });
    }
  }

  // ── AWS services ──────────────────────────────────────────────────────────

  for (const q of servicesMeta.sqs ?? []) {
    addNode({
      id: `queue:aws:${q.name}`,
      type: 'queue',
      name: q.name,
      provider: 'aws',
      hasDLQ: q.hasDLQ,
      encrypted: q.encrypted,
      approximateMessages: q.approximateMessages,
      retentionDays: q.retentionDays,
    });
  }

  for (const t of servicesMeta.sns ?? []) {
    addNode({
      id: `topic:aws:${t.name}`,
      type: 'topic',
      name: t.name,
      provider: 'aws',
      subscriptionCount: t.subscriptionCount,
      encrypted: t.encrypted,
      filterPolicies: t.filterPolicies?.length > 0 ? t.filterPolicies : undefined,
    });
  }

  for (const s of servicesMeta.secrets ?? []) {
    addNode({
      id: `secret:aws:${s.name}`,
      type: 'secret',
      name: s.name,
      provider: 'aws',
      rotationEnabled: s.rotationEnabled,
      rotationDays: s.rotationDays,
    });
  }

  for (const p of servicesMeta.ssm ?? []) {
    addNode({
      id: `parameter:aws:${p.name}`,
      type: 'parameter',
      name: p.name,
      provider: 'aws',
      paramType: p.type,
      tier: p.tier,
    });
  }

  for (const lg of servicesMeta.logs ?? []) {
    addNode({
      id: `log_group:aws:${lg.logGroupName}`,
      type: 'log_group',
      name: lg.logGroupName,
      provider: 'aws',
      retentionDays: lg.retentionDays,
      errorCount: lg.errorCount,
      topErrorPatterns: lg.topErrorPatterns,
    });
  }

  for (const fn of servicesMeta.lambda ?? []) {
    const lambdaId = `lambda:aws:${fn.name}`;
    addNode({
      id: lambdaId,
      type: 'lambda',
      name: fn.name,
      runtime: fn.runtime,
      memoryMB: fn.memoryMB,
      timeoutSec: fn.timeoutSec,
      envVarKeys: fn.envVarKeys,
      triggers: fn.triggers,
    });

    // Add trigger edges from source → lambda (only for enabled/active mappings)
    for (const trigger of fn.triggers ?? []) {
      if (trigger.state && trigger.state !== 'Enabled') continue;
      let sourceId: string;
      if (trigger.type === 'sqs') {
        sourceId = `queue:aws:${trigger.sourceName}`;
        addNode({
          id: sourceId,
          type: 'queue',
          name: trigger.sourceName,
          provider: 'aws',
          hasDLQ: false,
          encrypted: false,
        });
      } else if (trigger.type === 'dynamodb') {
        sourceId = `table:dynamo:${trigger.sourceName}`;
        addNode({
          id: sourceId,
          type: 'table',
          name: trigger.sourceName,
          databaseType: 'dynamodb',
        });
      } else if (trigger.type === 'kinesis') {
        sourceId = `queue:aws:${trigger.sourceName}`;
        addNode({
          id: sourceId,
          type: 'queue',
          name: trigger.sourceName,
          provider: 'aws',
          hasDLQ: false,
          encrypted: false,
        });
      } else {
        continue;
      }
      edges.push({ from: sourceId, to: lambdaId, type: 'triggers' });
    }
  }

  for (const rule of servicesMeta.eventbridge ?? []) {
    const ruleId = `eventbridge_rule:aws:${rule.name}`;
    addNode({
      id: ruleId,
      type: 'eventbridge_rule',
      name: rule.name,
      state: rule.state,
      scheduleExpression: rule.scheduleExpression,
      eventPattern: rule.eventPattern,
    });

    for (const targetArn of rule.targetArns) {
      const fnName = targetArn.split(':').pop() ?? '';
      const lambdaId = `lambda:aws:${fnName}`;
      if (!nodeIds.has(lambdaId)) continue;
      edges.push({ from: ruleId, to: lambdaId, type: 'triggers' });
      const lambdaNodeRef = nodeMap.get(lambdaId);
      if (lambdaNodeRef && lambdaNodeRef.type === 'lambda') {
        const trigger: LambdaTrigger = {
          type: 'eventbridge',
          sourceArn: rule.arn,
          sourceName: rule.name,
          eventShape: 'event.detail',
          ruleName: rule.name,
          eventPattern: rule.scheduleExpression ?? rule.eventPattern ?? '',
        };
        lambdaNodeRef.triggers = [...(lambdaNodeRef.triggers ?? []), trigger];
      }
    }
  }

  for (const db of servicesMeta.rds ?? []) {
    addNode({
      id: `database_instance:aws:${db.dbInstanceIdentifier}`,
      type: 'database_instance',
      name: db.dbInstanceIdentifier,
      provider: 'aws',
      engine: db.engine,
      engineVersion: db.engineVersion,
      instanceClass: db.instanceClass,
      publiclyAccessible: db.publiclyAccessible,
      storageEncrypted: db.storageEncrypted,
      backupRetentionDays: db.backupRetentionDays,
      deletionProtection: db.deletionProtection,
      multiAZ: db.multiAZ,
    });
  }

  // ── S3 Buckets ────────────────────────────────────────────────────────────────

  for (const bucket of servicesMeta.s3 ?? []) {
    const bucketId = `bucket:aws:${bucket.name}`;
    addNode({
      id: bucketId,
      type: 'bucket',
      name: bucket.name,
      provider: 'aws',
      versioned: bucket.versioned,
      encrypted: bucket.encrypted,
      publicAccessBlocked: bucket.publicAccessBlocked,
    });

    for (const notification of bucket.notifications) {
      const lambdaId = `lambda:aws:${notification.lambdaName}`;
      if (!nodeMap.has(lambdaId)) continue;
      edges.push({ from: bucketId, to: lambdaId, type: 'triggers' });
      const lambdaNode = nodeMap.get(lambdaId);
      if (lambdaNode && lambdaNode.type === 'lambda') {
        lambdaNode.triggers = [
          ...(lambdaNode.triggers ?? []),
          {
            type: 's3' as const,
            sourceArn: bucket.arn,
            sourceName: bucket.name,
            eventShape: 'event.Records[0].s3.object.key',
            events: notification.events,
          },
        ];
      }
    }
  }

  // ── Code operations (functions + edges) ───────────────────────────────────

  for (const op of operations) {
    const funcNodeId = `function:${op.filePath}:${op.functionName}`;
    addNode({ id: funcNodeId, type: 'function', name: op.functionName, file: op.filePath });

    // AWS service operations create edges to service nodes
    if (op.serviceType === 'sqs') {
      const queueId = `queue:aws:${op.target}`;
      addNode({
        id: queueId,
        type: 'queue',
        name: op.target,
        provider: 'aws',
        hasDLQ: false,
        encrypted: false,
      });
      edges.push({ from: funcNodeId, to: queueId, type: 'publishes_to' });
      continue;
    }

    if (op.serviceType === 'sns') {
      const topicId = `topic:aws:${op.target}`;
      addNode({ id: topicId, type: 'topic', name: op.target, provider: 'aws', encrypted: false });
      edges.push({ from: funcNodeId, to: topicId, type: 'publishes_to' });
      continue;
    }

    if (op.serviceType === 'kafka') {
      const topicId = `topic:kafka:${op.target}`;
      addNode({ id: topicId, type: 'topic', name: op.target, provider: 'kafka', encrypted: false });
      const edgeType = op.operationType === 'subscribe' ? 'subscribes_to' : 'publishes_to';
      edges.push({ from: funcNodeId, to: topicId, type: edgeType });
      continue;
    }

    if (op.serviceType === 'ssm') {
      const paramId = `parameter:aws:${op.target}`;
      addNode({
        id: paramId,
        type: 'parameter',
        name: op.target,
        provider: 'aws',
        paramType: 'String',
        tier: 'Standard',
      });
      edges.push({ from: funcNodeId, to: paramId, type: 'reads_parameter' });
      continue;
    }

    if (op.serviceType === 'secretsmanager') {
      const secretId = `secret:aws:${op.target}`;
      addNode({
        id: secretId,
        type: 'secret',
        name: op.target,
        provider: 'aws',
        rotationEnabled: false,
      });
      edges.push({ from: funcNodeId, to: secretId, type: 'reads_secret' });
      continue;
    }

    if (op.serviceType === 'lambda') {
      const lambdaId = `lambda:aws:${op.target}`;
      addNode({ id: lambdaId, type: 'lambda', name: op.target });
      edges.push({ from: funcNodeId, to: lambdaId, type: 'triggers' });
      continue;
    }

    // Database operations
    let tableNodeId: string;
    if (op.serviceType === 'dynamodb') {
      tableNodeId = `table:dynamo:${op.target}`;
      addNode({ id: tableNodeId, type: 'table', name: op.target, databaseType: 'dynamodb' });
    } else if (op.serviceType === 'mysql') {
      const q = op.target.includes('.') ? op.target : `default.${op.target}`;
      tableNodeId = `table:mysql:${q}`;
      addNode({ id: tableNodeId, type: 'table', name: q, databaseType: 'mysql' });
    } else if (op.serviceType === 'mongodb') {
      const q = op.target.includes('.') ? op.target : `default.${op.target}`;
      tableNodeId = `table:mongodb:${q}`;
      addNode({ id: tableNodeId, type: 'table', name: q, databaseType: 'mongodb' });
    } else {
      // postgres
      const q = op.target.includes('.') ? op.target : `public.${op.target}`;
      tableNodeId = `table:postgres:${q}`;
      addNode({ id: tableNodeId, type: 'table', name: q, databaseType: 'postgres' });
    }

    const edgeType = resolveEdgeType(op.operationType);
    edges.push({ from: funcNodeId, to: tableNodeId, type: edgeType });
  }

  return { nodes, edges };
}

function resolveEdgeType(
  operationType: string,
): Extract<GraphEdge, { type: 'query' | 'scan' | 'joins' }>['type'] {
  const op = operationType.toLowerCase();
  if (op === 'scan' || op === 'scancommand') return 'scan';
  if (op === 'join' || op === 'joins') return 'joins';
  return 'query';
}

// ── Typed node selectors ─────────────────────────────────────────────────────

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

export function getQueueNodes(graph: SystemGraph): Extract<GraphNode, { type: 'queue' }>[] {
  return graph.nodes.filter((n): n is Extract<GraphNode, { type: 'queue' }> => n.type === 'queue');
}

export function getTopicNodes(graph: SystemGraph): Extract<GraphNode, { type: 'topic' }>[] {
  return graph.nodes.filter((n): n is Extract<GraphNode, { type: 'topic' }> => n.type === 'topic');
}

export function getSecretNodes(graph: SystemGraph): Extract<GraphNode, { type: 'secret' }>[] {
  return graph.nodes.filter(
    (n): n is Extract<GraphNode, { type: 'secret' }> => n.type === 'secret',
  );
}

export function getParameterNodes(graph: SystemGraph): Extract<GraphNode, { type: 'parameter' }>[] {
  return graph.nodes.filter(
    (n): n is Extract<GraphNode, { type: 'parameter' }> => n.type === 'parameter',
  );
}

export function getLogGroupNodes(graph: SystemGraph): Extract<GraphNode, { type: 'log_group' }>[] {
  return graph.nodes.filter(
    (n): n is Extract<GraphNode, { type: 'log_group' }> => n.type === 'log_group',
  );
}

export function getLambdaNodes(graph: SystemGraph): Extract<GraphNode, { type: 'lambda' }>[] {
  return graph.nodes.filter(
    (n): n is Extract<GraphNode, { type: 'lambda' }> => n.type === 'lambda',
  );
}

export function getEventBridgeRuleNodes(
  graph: SystemGraph,
): Extract<GraphNode, { type: 'eventbridge_rule' }>[] {
  return graph.nodes.filter(
    (n): n is Extract<GraphNode, { type: 'eventbridge_rule' }> => n.type === 'eventbridge_rule',
  );
}

export function getBucketNodes(graph: SystemGraph): Extract<GraphNode, { type: 'bucket' }>[] {
  return graph.nodes.filter(
    (n): n is Extract<GraphNode, { type: 'bucket' }> => n.type === 'bucket',
  );
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
