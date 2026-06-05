import { describe, it, expect } from 'vitest';
import { MissingIndexAnalyzer, NplusOneAnalyzer, LargeSelectAnalyzer } from '../postgres';
import type { SystemGraph } from '../../types';

function makePostgresQueryGraph(withIndex = false): SystemGraph {
  const nodes: SystemGraph['nodes'] = [
    { id: 'fn:getPayment', type: 'function', name: 'getPayment', file: 'src/payments.ts' },
    {
      id: 'table:pg:public.payments',
      type: 'table',
      name: 'public.payments',
      databaseType: 'postgres',
    },
  ];
  const edges: SystemGraph['edges'] = [
    { from: 'fn:getPayment', to: 'table:pg:public.payments', type: 'query' },
  ];

  if (withIndex) {
    nodes.push({ id: 'index:public.payments:idx_status', type: 'index', name: 'idx_status' });
    edges.push({
      from: 'table:pg:public.payments',
      to: 'index:public.payments:idx_status',
      type: 'uses_index',
    });
  }

  return { nodes, edges };
}

describe('MissingIndexAnalyzer', () => {
  const analyzer = new MissingIndexAnalyzer();

  it('flags postgres table with queries but no index', async () => {
    const graph = makePostgresQueryGraph(false);
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('payments');
  });

  it('does not flag table that has indexes', async () => {
    const graph = makePostgresQueryGraph(true);
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(0);
  });

  it('ignores DynamoDB tables', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:getOrder', type: 'function', name: 'getOrder', file: 'src/orders.ts' },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ],
      edges: [{ from: 'fn:getOrder', to: 'table:dynamo:Orders', type: 'query' }],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings for empty graph', async () => {
    const findings = await analyzer.analyze({ nodes: [], edges: [] });
    expect(findings).toHaveLength(0);
  });
});

describe('NplusOneAnalyzer', () => {
  const analyzer = new NplusOneAnalyzer();

  it('detects N+1 when same function queries same table multiple times', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:processOrders', type: 'function', name: 'processOrders', file: 'src/orders.ts' },
        {
          id: 'table:pg:public.payments',
          type: 'table',
          name: 'public.payments',
          databaseType: 'postgres',
        },
      ],
      edges: [
        { from: 'fn:processOrders', to: 'table:pg:public.payments', type: 'query' },
        { from: 'fn:processOrders', to: 'table:pg:public.payments', type: 'query' },
      ],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].issue).toContain('processOrders');
    expect(findings[0].metadata?.queryCount).toBe(2);
  });

  it('does not flag single queries', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:getPayment', type: 'function', name: 'getPayment', file: 'src/pay.ts' },
        {
          id: 'table:pg:public.payments',
          type: 'table',
          name: 'public.payments',
          databaseType: 'postgres',
        },
      ],
      edges: [{ from: 'fn:getPayment', to: 'table:pg:public.payments', type: 'query' }],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(0);
  });

  it('ignores DynamoDB tables', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ],
      edges: [
        { from: 'fn:fn1', to: 'table:dynamo:Orders', type: 'query' },
        { from: 'fn:fn1', to: 'table:dynamo:Orders', type: 'query' },
      ],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(0);
  });
});

describe('LargeSelectAnalyzer', () => {
  const analyzer = new LargeSelectAnalyzer();

  it('flags sequential scan on postgres table', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:listAll', type: 'function', name: 'listAll', file: 'src/x.ts' },
        {
          id: 'table:pg:public.orders',
          type: 'table',
          name: 'public.orders',
          databaseType: 'postgres',
        },
      ],
      edges: [{ from: 'fn:listAll', to: 'table:pg:public.orders', type: 'scan' }],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe('medium');
  });

  it('flags select * query node', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'query:1', type: 'query', operation: 'SELECT * FROM orders' }],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings.some((f) => f.issue.includes('SELECT *'))).toBe(true);
  });

  it('returns empty findings for clean graph', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:getOne', type: 'function', name: 'getOne', file: 'src/x.ts' },
        {
          id: 'table:pg:public.orders',
          type: 'table',
          name: 'public.orders',
          databaseType: 'postgres',
        },
      ],
      edges: [{ from: 'fn:getOne', to: 'table:pg:public.orders', type: 'query' }],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(0);
  });
});
