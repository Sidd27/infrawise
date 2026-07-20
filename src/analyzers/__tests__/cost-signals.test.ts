import { describe, it, expect } from 'vitest';
import {
  LambdaHighMemoryAnalyzer,
  RDSMultiAZNonProdAnalyzer,
  lambdaCostSignal,
  dynamoCostSignal,
  cacheCostSignal,
} from '../cost-signals';
import type { SystemGraph, GraphNode } from '../../types';

function lambdaNode(
  overrides: Partial<Extract<GraphNode, { type: 'lambda' }>> = {},
): Extract<GraphNode, { type: 'lambda' }> {
  return { id: 'lambda:aws:fn', type: 'lambda', name: 'fn', memoryMB: 128, ...overrides };
}

function dbInstanceNode(
  overrides: Partial<Extract<GraphNode, { type: 'database_instance' }>> = {},
): Extract<GraphNode, { type: 'database_instance' }> {
  return {
    id: 'database_instance:aws:db',
    type: 'database_instance',
    name: 'db',
    provider: 'aws',
    engine: 'postgres',
    engineVersion: '15.4',
    instanceClass: 'db.t3.medium',
    publiclyAccessible: false,
    storageEncrypted: true,
    backupRetentionDays: 7,
    deletionProtection: true,
    multiAZ: false,
    ...overrides,
  };
}

function tableNode(
  overrides: Partial<Extract<GraphNode, { type: 'table' }>> = {},
): Extract<GraphNode, { type: 'table' }> {
  return {
    id: 'table:dynamo:orders',
    type: 'table',
    name: 'orders',
    databaseType: 'dynamodb',
    ...overrides,
  };
}

function cacheNode(
  overrides: Partial<Extract<GraphNode, { type: 'cache_cluster' }>> = {},
): Extract<GraphNode, { type: 'cache_cluster' }> {
  return {
    id: 'cache_cluster:aws:cache',
    type: 'cache_cluster',
    name: 'cache',
    provider: 'aws',
    engine: 'redis',
    numNodes: 1,
    ...overrides,
  };
}

describe('LambdaHighMemoryAnalyzer', () => {
  const analyzer = new LambdaHighMemoryAnalyzer();

  it('flags high memory with zero recent throttles', async () => {
    const graph: SystemGraph = {
      nodes: [lambdaNode({ memoryMB: 3008, recentThrottles: 0 })],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
    expect(findings[0].issue).toContain('fn');
  });

  it('does not flag when memory is below the threshold', async () => {
    const graph: SystemGraph = {
      nodes: [lambdaNode({ memoryMB: 1024, recentThrottles: 0 })],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('does not flag when runtime signals are absent', async () => {
    const graph: SystemGraph = {
      nodes: [lambdaNode({ memoryMB: 3008, recentThrottles: undefined })],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('does not flag when there are recent throttles', async () => {
    const graph: SystemGraph = {
      nodes: [lambdaNode({ memoryMB: 3008, recentThrottles: 2 })],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('RDSMultiAZNonProdAnalyzer', () => {
  const analyzer = new RDSMultiAZNonProdAnalyzer();

  it('flags Multi-AZ on a non-production-looking name', async () => {
    const graph: SystemGraph = {
      nodes: [dbInstanceNode({ name: 'orders-staging', multiAZ: true })],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
    expect(findings[0].issue).toContain('orders-staging');
  });

  it('does not flag Multi-AZ on a production-looking name', async () => {
    const graph: SystemGraph = {
      nodes: [dbInstanceNode({ name: 'orders-prod', multiAZ: true })],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('does not flag single-AZ instances', async () => {
    const graph: SystemGraph = {
      nodes: [dbInstanceNode({ name: 'orders-staging', multiAZ: false })],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('lambdaCostSignal', () => {
  it('returns an advisory when memory is high and signals are absent', () => {
    expect(lambdaCostSignal(lambdaNode({ memoryMB: 3008 }))).toContain('3008 MB');
  });

  it('returns undefined when memory is below the threshold', () => {
    expect(lambdaCostSignal(lambdaNode({ memoryMB: 1024 }))).toBeUndefined();
  });

  it('returns undefined when runtime signals are present (Finding covers it instead)', () => {
    expect(lambdaCostSignal(lambdaNode({ memoryMB: 3008, recentThrottles: 0 }))).toBeUndefined();
  });
});

describe('dynamoCostSignal', () => {
  it('returns an advisory for provisioned-capacity tables', () => {
    expect(dynamoCostSignal(tableNode({ billingMode: 'PROVISIONED' }))).toContain('Provisioned');
  });

  it('returns undefined for on-demand tables', () => {
    expect(dynamoCostSignal(tableNode({ billingMode: 'PAY_PER_REQUEST' }))).toBeUndefined();
  });

  it('returns undefined for non-DynamoDB tables', () => {
    expect(
      dynamoCostSignal(tableNode({ databaseType: 'postgres', billingMode: 'PROVISIONED' })),
    ).toBeUndefined();
  });
});

describe('cacheCostSignal', () => {
  it('returns an advisory for clusters with more than 3 nodes', () => {
    expect(cacheCostSignal(cacheNode({ numNodes: 4 }))).toContain('4 nodes');
  });

  it('returns undefined for clusters with 3 or fewer nodes', () => {
    expect(cacheCostSignal(cacheNode({ numNodes: 3 }))).toBeUndefined();
  });
});
