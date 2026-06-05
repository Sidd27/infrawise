import { describe, it, expect } from 'vitest';
import { MissingMongoIndexAnalyzer, MongoCollectionScanAnalyzer } from '../mongodb';
import type { SystemGraph } from '../../types';

function makeMongoQueryGraph(withIndex = false): SystemGraph {
  const nodes: SystemGraph['nodes'] = [
    { id: 'fn:getUser', type: 'function', name: 'getUser', file: 'src/users.ts' },
    { id: 'table:mongodb:app.users', type: 'table', name: 'app.users', databaseType: 'mongodb' },
  ];
  const edges: SystemGraph['edges'] = [
    { from: 'fn:getUser', to: 'table:mongodb:app.users', type: 'query' },
  ];
  if (withIndex) {
    nodes.push({ id: 'index:app.users:idx_email', type: 'index', name: 'idx_email' });
    edges.push({
      from: 'table:mongodb:app.users',
      to: 'index:app.users:idx_email',
      type: 'uses_index',
    });
  }
  return { nodes, edges };
}

describe('MissingMongoIndexAnalyzer', () => {
  const analyzer = new MissingMongoIndexAnalyzer();

  it('flags collection queried without indexes', async () => {
    const findings = await analyzer.analyze(makeMongoQueryGraph(false));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('app.users');
  });

  it('does not flag collection that has indexes', async () => {
    const findings = await analyzer.analyze(makeMongoQueryGraph(true));
    expect(findings).toHaveLength(0);
  });

  it('ignores non-mongodb tables', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ],
      edges: [{ from: 'fn:fn1', to: 'table:dynamo:Orders', type: 'query' }],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('returns empty findings for empty graph', async () => {
    expect(await analyzer.analyze({ nodes: [], edges: [] })).toHaveLength(0);
  });

  it('includes caller function names in metadata', async () => {
    const findings = await analyzer.analyze(makeMongoQueryGraph(false));
    expect(findings[0].metadata?.callerFunctions).toContain('getUser');
    expect(findings[0].metadata?.queryCount).toBe(1);
  });

  it('flags collection accessed by scan edge as well', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:listAll', type: 'function', name: 'listAll', file: 'src/users.ts' },
        {
          id: 'table:mongodb:app.users',
          type: 'table',
          name: 'app.users',
          databaseType: 'mongodb',
        },
      ],
      edges: [{ from: 'fn:listAll', to: 'table:mongodb:app.users', type: 'scan' }],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
  });
});

describe('MongoCollectionScanAnalyzer', () => {
  const analyzer = new MongoCollectionScanAnalyzer();

  it('detects a collection scan', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:listAll', type: 'function', name: 'listAll', file: 'src/users.ts' },
        {
          id: 'table:mongodb:app.users',
          type: 'table',
          name: 'app.users',
          databaseType: 'mongodb',
        },
      ],
      edges: [{ from: 'fn:listAll', to: 'table:mongodb:app.users', type: 'scan' }],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].issue).toContain('app.users');
  });

  it('returns no findings when no scans exist', async () => {
    expect(await analyzer.analyze(makeMongoQueryGraph(false))).toHaveLength(0);
  });

  it('does not flag non-mongodb tables on scan', async () => {
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
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('emits one finding per collection with correct scan count in metadata', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'fn:a', type: 'function', name: 'a', file: 'a.ts' },
        { id: 'fn:b', type: 'function', name: 'b', file: 'b.ts' },
        {
          id: 'table:mongodb:app.users',
          type: 'table',
          name: 'app.users',
          databaseType: 'mongodb',
        },
      ],
      edges: [
        { from: 'fn:a', to: 'table:mongodb:app.users', type: 'scan' },
        { from: 'fn:b', to: 'table:mongodb:app.users', type: 'scan' },
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
