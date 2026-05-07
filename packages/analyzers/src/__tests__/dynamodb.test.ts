import { describe, it, expect } from 'vitest';
import { FullTableScanAnalyzer, MissingGSIAnalyzer, HotPartitionAnalyzer } from '../dynamodb';
import type { SystemGraph } from '@infrawise/shared';

// Helper: build a minimal graph with DynamoDB scan
function makeScanGraph(): SystemGraph {
  return {
    nodes: [
      { id: 'fn:listAll', type: 'function', name: 'listAll', file: 'src/orders.ts' },
      { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
    ],
    edges: [{ from: 'fn:listAll', to: 'table:dynamo:Orders', type: 'scan' }],
  };
}

function makeQueryGraph(): SystemGraph {
  return {
    nodes: [
      { id: 'fn:getOrder', type: 'function', name: 'getOrder', file: 'src/orders.ts' },
      { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
    ],
    edges: [{ from: 'fn:getOrder', to: 'table:dynamo:Orders', type: 'query' }],
  };
}

function makeGraphWithGSI(): SystemGraph {
  return {
    nodes: [
      { id: 'fn:getOrder', type: 'function', name: 'getOrder', file: 'src/orders.ts' },
      { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      { id: 'index:Orders:StatusIndex', type: 'index', name: 'StatusIndex' },
    ],
    edges: [
      { from: 'fn:getOrder', to: 'table:dynamo:Orders', type: 'query' },
      { from: 'table:dynamo:Orders', to: 'index:Orders:StatusIndex', type: 'uses_index' },
    ],
  };
}

describe('FullTableScanAnalyzer', () => {
  const analyzer = new FullTableScanAnalyzer();

  it('detects a full table scan', async () => {
    const graph = makeScanGraph();
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].issue).toContain('Orders');
  });

  it('returns no findings when no scans', async () => {
    const graph = makeQueryGraph();
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(0);
  });

  it('detects multiple scan findings for different tables', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:listAll', type: 'function', name: 'listAll', file: 'src/orders.ts' },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
        { id: 'table:dynamo:Users', type: 'table', name: 'Users', databaseType: 'dynamodb' },
      ],
      edges: [
        { from: 'fn:listAll', to: 'table:dynamo:Orders', type: 'scan' },
        { from: 'fn:listAll', to: 'table:dynamo:Users', type: 'scan' },
      ],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(2);
  });

  it('does not flag postgres tables', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:listAll', type: 'function', name: 'listAll', file: 'src/pg.ts' },
        { id: 'table:pg:public.orders', type: 'table', name: 'public.orders', databaseType: 'postgres' },
      ],
      edges: [{ from: 'fn:listAll', to: 'table:pg:public.orders', type: 'scan' }],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(0);
  });
});

describe('MissingGSIAnalyzer', () => {
  const analyzer = new MissingGSIAnalyzer();

  it('flags table with queries but no GSI', async () => {
    const graph = makeQueryGraph();
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('Orders');
  });

  it('does not flag table that has a GSI', async () => {
    const graph = makeGraphWithGSI();
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings for empty graph', async () => {
    const findings = await analyzer.analyze({ nodes: [], edges: [] });
    expect(findings).toHaveLength(0);
  });
});

describe('HotPartitionAnalyzer', () => {
  it('detects hot partition when table accessed by many functions', async () => {
    const analyzer = new HotPartitionAnalyzer(3); // threshold = 3

    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:a', type: 'function', name: 'a', file: 'a.ts' },
        { id: 'fn:b', type: 'function', name: 'b', file: 'b.ts' },
        { id: 'fn:c', type: 'function', name: 'c', file: 'c.ts' },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ],
      edges: [
        { from: 'fn:a', to: 'table:dynamo:Orders', type: 'query' },
        { from: 'fn:b', to: 'table:dynamo:Orders', type: 'query' },
        { from: 'fn:c', to: 'table:dynamo:Orders', type: 'query' },
      ],
    };

    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].issue).toContain('Orders');
  });

  it('does not flag table below threshold', async () => {
    const analyzer = new HotPartitionAnalyzer(5);
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:a', type: 'function', name: 'a', file: 'a.ts' },
        { id: 'fn:b', type: 'function', name: 'b', file: 'b.ts' },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ],
      edges: [
        { from: 'fn:a', to: 'table:dynamo:Orders', type: 'query' },
        { from: 'fn:b', to: 'table:dynamo:Orders', type: 'query' },
      ],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(0);
  });
});
