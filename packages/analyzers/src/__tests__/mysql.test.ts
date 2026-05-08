import { describe, it, expect } from 'vitest';
import { MissingMySQLIndexAnalyzer, MySQLFullTableScanAnalyzer } from '../mysql';
import type { SystemGraph } from '@infrawise/shared';

function makeMySQLQueryGraph(withIndex = false): SystemGraph {
  const nodes: SystemGraph['nodes'] = [
    { id: 'fn:getOrder', type: 'function', name: 'getOrder', file: 'src/orders.ts' },
    { id: 'table:mysql:shop.orders', type: 'table', name: 'shop.orders', databaseType: 'mysql' },
  ];
  const edges: SystemGraph['edges'] = [
    { from: 'fn:getOrder', to: 'table:mysql:shop.orders', type: 'query' },
  ];
  if (withIndex) {
    nodes.push({ id: 'index:shop.orders:idx_status', type: 'index', name: 'idx_status' });
    edges.push({ from: 'table:mysql:shop.orders', to: 'index:shop.orders:idx_status', type: 'uses_index' });
  }
  return { nodes, edges };
}

describe('MissingMySQLIndexAnalyzer', () => {
  const analyzer = new MissingMySQLIndexAnalyzer();

  it('flags MySQL table queried without indexes', async () => {
    const findings = await analyzer.analyze(makeMySQLQueryGraph(false));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('shop.orders');
  });

  it('does not flag table that has indexes', async () => {
    expect(await analyzer.analyze(makeMySQLQueryGraph(true))).toHaveLength(0);
  });

  it('ignores non-mysql tables', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' },
        { id: 'table:pg:public.orders', type: 'table', name: 'public.orders', databaseType: 'postgres' },
      ],
      edges: [{ from: 'fn:fn1', to: 'table:pg:public.orders', type: 'query' }],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('returns empty findings for empty graph', async () => {
    expect(await analyzer.analyze({ nodes: [], edges: [] })).toHaveLength(0);
  });

  it('includes caller function names and query count in metadata', async () => {
    const findings = await analyzer.analyze(makeMySQLQueryGraph(false));
    expect(findings[0].metadata?.callerFunctions).toContain('getOrder');
    expect(findings[0].metadata?.queryCount).toBe(1);
  });

  it('counts both query and scan edges toward queryCount', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' },
        { id: 'fn:fn2', type: 'function', name: 'fn2', file: 'src/y.ts' },
        { id: 'table:mysql:shop.orders', type: 'table', name: 'shop.orders', databaseType: 'mysql' },
      ],
      edges: [
        { from: 'fn:fn1', to: 'table:mysql:shop.orders', type: 'query' },
        { from: 'fn:fn2', to: 'table:mysql:shop.orders', type: 'scan' },
      ],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].metadata?.queryCount).toBe(2);
  });
});

describe('MySQLFullTableScanAnalyzer', () => {
  const analyzer = new MySQLFullTableScanAnalyzer();

  it('detects a full table scan on a MySQL table', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:listAll', type: 'function', name: 'listAll', file: 'src/orders.ts' },
        { id: 'table:mysql:shop.orders', type: 'table', name: 'shop.orders', databaseType: 'mysql' },
      ],
      edges: [{ from: 'fn:listAll', to: 'table:mysql:shop.orders', type: 'scan' }],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].issue).toContain('shop.orders');
  });

  it('returns no findings when no scans exist', async () => {
    expect(await analyzer.analyze(makeMySQLQueryGraph(false))).toHaveLength(0);
  });

  it('does not flag non-mysql tables on scan', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:listAll', type: 'function', name: 'listAll', file: 'src/x.ts' },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ],
      edges: [{ from: 'fn:listAll', to: 'table:dynamo:Orders', type: 'scan' }],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('emits one finding per table with correct scan count', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:a', type: 'function', name: 'a', file: 'a.ts' },
        { id: 'fn:b', type: 'function', name: 'b', file: 'b.ts' },
        { id: 'table:mysql:shop.orders', type: 'table', name: 'shop.orders', databaseType: 'mysql' },
      ],
      edges: [
        { from: 'fn:a', to: 'table:mysql:shop.orders', type: 'scan' },
        { from: 'fn:b', to: 'table:mysql:shop.orders', type: 'scan' },
      ],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].metadata?.scanCount).toBe(2);
  });

  it('returns empty findings for empty graph', async () => {
    expect(await analyzer.analyze({ nodes: [], edges: [] })).toHaveLength(0);
  });
});
