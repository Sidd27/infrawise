import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  getTableNodes,
  getFunctionNodes,
  getIndexNodes,
  getQueueNodes,
  getTopicNodes,
  getSecretNodes,
  getParameterNodes,
  getLambdaNodes,
  getLogGroupNodes,
  getScanEdges,
  getEdgeFrequency,
  getEdgesForNode,
  getOutgoingEdges,
  getIncomingEdges,
} from '../index';
import type {
  ExtractedOperation,
  DynamoTableMetadata,
  PostgresTableMetadata,
  MySQLTableMetadata,
  MongoCollectionMetadata,
  ServicesMeta,
} from '@infrawise/shared';

const mockDynamoMeta: DynamoTableMetadata[] = [
  {
    tableName: 'Orders',
    partitionKey: 'orderId',
    sortKey: 'createdAt',
    indexes: ['StatusIndex', 'UserIndex'],
  },
  {
    tableName: 'Users',
    partitionKey: 'userId',
    indexes: [],
  },
];

const mockPostgresMeta: PostgresTableMetadata[] = [
  {
    schema: 'public',
    table: 'payments',
    columns: ['id', 'amount', 'status', 'user_id'],
    indexes: ['payments_pkey', 'idx_payments_user_id'],
    primaryKeys: ['id'],
  },
];

const mockOperations: ExtractedOperation[] = [
  {
    functionName: 'getOrder',
    operationType: 'query',
    databaseType: 'dynamodb',
    target: 'Orders',
    filePath: 'src/orders.ts',
  },
  {
    functionName: 'listAllOrders',
    operationType: 'scan',
    databaseType: 'dynamodb',
    target: 'Orders',
    filePath: 'src/orders.ts',
  },
  {
    functionName: 'getPayments',
    operationType: 'query',
    databaseType: 'postgres',
    target: 'public.payments',
    filePath: 'src/payments.ts',
  },
];

describe('buildGraph', () => {
  it('creates table nodes from DynamoDB metadata', () => {
    const graph = buildGraph([], mockDynamoMeta, []);
    const tableNodes = getTableNodes(graph);
    expect(tableNodes.some((n) => n.name === 'Orders' && n.databaseType === 'dynamodb')).toBe(true);
    expect(tableNodes.some((n) => n.name === 'Users' && n.databaseType === 'dynamodb')).toBe(true);
  });

  it('creates table nodes from PostgreSQL metadata', () => {
    const graph = buildGraph([], [], mockPostgresMeta);
    const tableNodes = getTableNodes(graph);
    expect(tableNodes.some((n) => n.databaseType === 'postgres')).toBe(true);
  });

  it('creates index nodes and uses_index edges for DynamoDB', () => {
    const graph = buildGraph([], mockDynamoMeta, []);
    const indexNodes = getIndexNodes(graph);
    expect(indexNodes.some((n) => n.name === 'StatusIndex')).toBe(true);
    expect(indexNodes.some((n) => n.name === 'UserIndex')).toBe(true);
    const usesIndexEdges = graph.edges.filter((e) => e.type === 'uses_index');
    expect(usesIndexEdges.length).toBeGreaterThan(0);
  });

  it('creates function nodes from extracted operations', () => {
    const graph = buildGraph(mockOperations, mockDynamoMeta, mockPostgresMeta);
    const funcNodes = getFunctionNodes(graph);
    expect(funcNodes.some((n) => n.name === 'getOrder')).toBe(true);
    expect(funcNodes.some((n) => n.name === 'listAllOrders')).toBe(true);
    expect(funcNodes.some((n) => n.name === 'getPayments')).toBe(true);
  });

  it('creates query edges for query operations', () => {
    const graph = buildGraph(mockOperations, mockDynamoMeta, mockPostgresMeta);
    const queryEdges = graph.edges.filter((e) => e.type === 'query');
    expect(queryEdges.length).toBeGreaterThan(0);
  });

  it('creates scan edges for scan operations', () => {
    const graph = buildGraph(mockOperations, mockDynamoMeta, mockPostgresMeta);
    const scanEdges = getScanEdges(graph);
    expect(scanEdges.length).toBeGreaterThan(0);
  });

  it('does not create duplicate nodes for same table', () => {
    const ops: ExtractedOperation[] = [
      { functionName: 'fn1', operationType: 'query', databaseType: 'dynamodb', target: 'Orders', filePath: 'a.ts' },
      { functionName: 'fn2', operationType: 'query', databaseType: 'dynamodb', target: 'Orders', filePath: 'b.ts' },
    ];
    const graph = buildGraph(ops, mockDynamoMeta, []);
    const ordersNodes = graph.nodes.filter((n) => n.type === 'table' && 'name' in n && n.name === 'Orders');
    expect(ordersNodes).toHaveLength(1);
  });

  it('computes edge frequency correctly', () => {
    const ops: ExtractedOperation[] = [
      { functionName: 'fn1', operationType: 'query', databaseType: 'dynamodb', target: 'Orders', filePath: 'a.ts' },
      { functionName: 'fn1', operationType: 'query', databaseType: 'dynamodb', target: 'Orders', filePath: 'a.ts' },
    ];
    const graph = buildGraph(ops, mockDynamoMeta, []);
    const freq = getEdgeFrequency(graph);
    const maxFreq = Math.max(...freq.values());
    expect(maxFreq).toBeGreaterThanOrEqual(2);
  });

  it('handles empty inputs gracefully', () => {
    const graph = buildGraph([], [], []);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('creates MySQL table and index nodes from metadata', () => {
    const mysqlMeta: MySQLTableMetadata[] = [
      { schema: 'shop', table: 'orders', columns: ['id', 'status'], indexes: ['idx_status'], primaryKeys: ['id'] },
    ];
    const graph = buildGraph([], [], [], mysqlMeta);
    const tables = getTableNodes(graph);
    expect(tables.some((n) => n.databaseType === 'mysql' && n.name === 'shop.orders')).toBe(true);
    expect(getIndexNodes(graph).some((n) => n.name === 'idx_status')).toBe(true);
  });

  it('creates MongoDB collection and index nodes from metadata, skipping _id_', () => {
    const mongoMeta: MongoCollectionMetadata[] = [
      { database: 'app', collection: 'users', indexes: [{ name: '_id_' }, { name: 'idx_email' }] },
    ];
    const graph = buildGraph([], [], [], [], mongoMeta);
    const tables = getTableNodes(graph);
    expect(tables.some((n) => n.databaseType === 'mongodb' && n.name === 'app.users')).toBe(true);
    const indexNames = getIndexNodes(graph).map((n) => n.name);
    expect(indexNames).toContain('idx_email');
    expect(indexNames).not.toContain('_id_');
  });

  it('creates SQS queue nodes from servicesMeta', () => {
    const services: ServicesMeta = {
      sqs: [{ name: 'orders-queue', hasDLQ: true, encrypted: true, approximateMessages: 0 }],
    };
    const graph = buildGraph([], [], [], [], [], services);
    const queues = getQueueNodes(graph);
    expect(queues).toHaveLength(1);
    expect(queues[0].name).toBe('orders-queue');
    expect(queues[0].hasDLQ).toBe(true);
  });

  it('creates SNS topic nodes from servicesMeta', () => {
    const services: ServicesMeta = {
      sns: [{ name: 'order-events', subscriptionCount: 2, encrypted: true }],
    };
    const graph = buildGraph([], [], [], [], [], services);
    const topics = getTopicNodes(graph);
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe('order-events');
  });

  it('creates Lambda nodes from servicesMeta', () => {
    const services: ServicesMeta = {
      lambda: [{ name: 'processOrders', runtime: 'nodejs22.x', memoryMB: 512, timeoutSec: 30, envVarKeys: [] }],
    };
    const graph = buildGraph([], [], [], [], [], services);
    const lambdas = getLambdaNodes(graph);
    expect(lambdas).toHaveLength(1);
    expect(lambdas[0].memoryMB).toBe(512);
  });

  it('creates secret nodes from servicesMeta', () => {
    const services: ServicesMeta = {
      secrets: [{ name: 'db-password', rotationEnabled: false }],
    };
    const graph = buildGraph([], [], [], [], [], services);
    const secrets = getSecretNodes(graph);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].rotationEnabled).toBe(false);
  });

  it('creates SSM parameter nodes from servicesMeta', () => {
    const services: ServicesMeta = {
      ssm: [{ name: '/app/db-url', type: 'SecureString', tier: 'Standard' }],
    };
    const graph = buildGraph([], [], [], [], [], services);
    const params = getParameterNodes(graph);
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('/app/db-url');
  });

  it('creates log group nodes from servicesMeta', () => {
    const services: ServicesMeta = {
      logs: [{ logGroupName: '/app/api', retentionDays: 90, errorCount: 0, topErrorPatterns: [] }],
    };
    const graph = buildGraph([], [], [], [], [], services);
    const logGroups = getLogGroupNodes(graph);
    expect(logGroups).toHaveLength(1);
    expect(logGroups[0].retentionDays).toBe(90);
  });

  it('creates publishes_to edge for SQS operation', () => {
    const ops: ExtractedOperation[] = [
      { functionName: 'sendOrder', operationType: 'send', databaseType: 'sqs', target: 'orders-queue', filePath: 'src/orders.ts' },
    ];
    const graph = buildGraph(ops, [], []);
    const edge = graph.edges.find((e) => e.type === 'publishes_to');
    expect(edge).toBeDefined();
    expect(edge?.to).toBe('queue:aws:orders-queue');
  });

  it('creates triggers edge for Lambda invocation', () => {
    const ops: ExtractedOperation[] = [
      { functionName: 'handler', operationType: 'invoke', databaseType: 'lambda', target: 'processOrders', filePath: 'src/handler.ts' },
    ];
    const graph = buildGraph(ops, [], []);
    const edge = graph.edges.find((e) => e.type === 'triggers');
    expect(edge).toBeDefined();
    expect(edge?.to).toBe('lambda:aws:processOrders');
  });

  it('creates reads_secret edge for Secrets Manager operation', () => {
    const ops: ExtractedOperation[] = [
      { functionName: 'getSecret', operationType: 'getSecretValue', databaseType: 'secretsmanager', target: 'db-password', filePath: 'src/secrets.ts' },
    ];
    const graph = buildGraph(ops, [], []);
    expect(graph.edges.some((e) => e.type === 'reads_secret')).toBe(true);
  });

  it('creates reads_parameter edge for SSM operation', () => {
    const ops: ExtractedOperation[] = [
      { functionName: 'getParam', operationType: 'getParameter', databaseType: 'ssm', target: '/app/db-url', filePath: 'src/config.ts' },
    ];
    const graph = buildGraph(ops, [], []);
    expect(graph.edges.some((e) => e.type === 'reads_parameter')).toBe(true);
  });

  it('does not duplicate service nodes when operation target already exists in servicesMeta', () => {
    const services: ServicesMeta = {
      sqs: [{ name: 'orders-queue', hasDLQ: true, encrypted: true, approximateMessages: 0 }],
    };
    const ops: ExtractedOperation[] = [
      { functionName: 'sendOrder', operationType: 'send', databaseType: 'sqs', target: 'orders-queue', filePath: 'src/orders.ts' },
    ];
    const graph = buildGraph(ops, [], [], [], [], services);
    const queueNodes = graph.nodes.filter((n) => n.type === 'queue' && n.name === 'orders-queue');
    expect(queueNodes).toHaveLength(1);
  });
});

describe('edge selectors', () => {
  const graph = buildGraph(
    [
      { functionName: 'getOrder', operationType: 'query', databaseType: 'dynamodb', target: 'Orders', filePath: 'src/orders.ts' },
      { functionName: 'listOrders', operationType: 'scan', databaseType: 'dynamodb', target: 'Orders', filePath: 'src/orders.ts' },
    ],
    [{ tableName: 'Orders', partitionKey: 'orderId', indexes: [] }],
    [],
  );

  it('getEdgesForNode returns all edges connected to a node', () => {
    const ordersNodeId = 'table:dynamo:Orders';
    const edges = getEdgesForNode(graph, ordersNodeId);
    expect(edges.length).toBeGreaterThanOrEqual(2);
    expect(edges.every((e) => e.from === ordersNodeId || e.to === ordersNodeId)).toBe(true);
  });

  it('getOutgoingEdges returns only edges where node is the source', () => {
    const funcNodeId = 'function:src/orders.ts:getOrder';
    const edges = getOutgoingEdges(graph, funcNodeId);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.from === funcNodeId)).toBe(true);
  });

  it('getIncomingEdges returns only edges where node is the target', () => {
    const ordersNodeId = 'table:dynamo:Orders';
    const edges = getIncomingEdges(graph, ordersNodeId);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.to === ordersNodeId)).toBe(true);
  });

  it('getEdgesForNode returns empty array for unknown node', () => {
    expect(getEdgesForNode(graph, 'nonexistent:node')).toHaveLength(0);
  });
});
