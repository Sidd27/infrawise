import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  getTableNodes,
  getFunctionNodes,
  getIndexNodes,
  getScanEdges,
  getEdgeFrequency,
} from '../index';
import type { ExtractedOperation, DynamoTableMetadata, PostgresTableMetadata } from '@infrawise/shared';

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
});
