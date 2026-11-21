import { describe, it, expect } from 'vitest';
import type { SystemGraph } from '../../types.js';
import type { IaCLambda } from '../../adapters/iac/terraform.js';
import { normalizeName, HeuristicLinker, HandlerLinker, compositeLink } from '../linkers.js';

function graphWith(lambdaName: string, fnName: string, fnFile: string): SystemGraph {
  return {
    nodes: [
      { id: `lambda:aws:${lambdaName}`, type: 'lambda', name: lambdaName },
      { id: `function:${fnFile}:${fnName}`, type: 'function', name: fnName, file: fnFile },
    ],
    edges: [],
  };
}

describe('normalizeName', () => {
  it('collapses separators, case, stage suffix and noise tokens', () => {
    expect(normalizeName('process-orders-prod')).toBe('processorders');
    expect(normalizeName('processOrders')).toBe('processorders');
    expect(normalizeName('order-handler')).toBe('order');
    expect(normalizeName('src/orders.ts')).toBe('orders');
    expect(normalizeName('handler')).toBe('');
  });
});

describe('HeuristicLinker', () => {
  it('links by normalized name match as inferred', () => {
    const { links } = new HeuristicLinker().link(
      graphWith('process-orders-prod', 'processOrders', 'src/a.ts'),
    );
    expect(links).toEqual([
      {
        lambdaId: 'lambda:aws:process-orders-prod',
        functionId: 'function:src/a.ts:processOrders',
        confidence: 'inferred',
      },
    ]);
  });

  it('links by normalized file basename when the export is generic', () => {
    const { links } = new HeuristicLinker().link(graphWith('orders', 'handler', 'src/orders.ts'));
    expect(links).toEqual([
      {
        lambdaId: 'lambda:aws:orders',
        functionId: 'function:src/orders.ts:handler',
        confidence: 'inferred',
      },
    ]);
  });

  it('records no_match when nothing matches', () => {
    expect(new HeuristicLinker().link(graphWith('alpha', 'beta', 'src/beta.ts'))).toEqual({
      links: [],
      unresolved: [{ lambdaId: 'lambda:aws:alpha', reason: 'no_match', candidates: [] }],
    });
  });

  it('records multiple_functions with the candidate ids when several functions match', () => {
    const g: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:orders', type: 'lambda', name: 'orders' },
        { id: 'function:a.ts:orders', type: 'function', name: 'orders', file: 'a.ts' },
        { id: 'function:b.ts:orders', type: 'function', name: 'orders', file: 'b.ts' },
      ],
      edges: [],
    };
    expect(new HeuristicLinker().link(g)).toEqual({
      links: [],
      unresolved: [
        {
          lambdaId: 'lambda:aws:orders',
          reason: 'multiple_functions',
          candidates: ['function:a.ts:orders', 'function:b.ts:orders'],
        },
      ],
    });
  });

  it('links nothing when two Lambdas normalize to one key and records each naming the other', () => {
    const g: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:checkout-handler-prod', type: 'lambda', name: 'checkout-handler-prod' },
        { id: 'lambda:aws:checkout-dev', type: 'lambda', name: 'checkout-dev' },
        {
          id: 'function:checkout.ts:checkout',
          type: 'function',
          name: 'checkout',
          file: 'checkout.ts',
        },
      ],
      edges: [],
    };
    expect(new HeuristicLinker().link(g)).toEqual({
      links: [],
      unresolved: [
        {
          lambdaId: 'lambda:aws:checkout-handler-prod',
          reason: 'multiple_lambdas',
          candidates: ['checkout-dev'],
        },
        {
          lambdaId: 'lambda:aws:checkout-dev',
          reason: 'multiple_lambdas',
          candidates: ['checkout-handler-prod'],
        },
      ],
    });
  });
});

describe('HandlerLinker', () => {
  const iac: IaCLambda[] = [
    {
      name: 'fulfill-prod',
      handler: 'src/fulfill.handler',
      source: 'terraform',
      filePath: 'main.tf',
    },
  ];

  it('links via the IaC handler as proven', () => {
    const g: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:fulfill-prod', type: 'lambda', name: 'fulfill-prod' },
        {
          id: 'function:src/fulfill.ts:handler',
          type: 'function',
          name: 'handler',
          file: 'src/fulfill.ts',
        },
      ],
      edges: [],
    };
    expect(new HandlerLinker(iac).link(g)).toEqual({
      links: [
        {
          lambdaId: 'lambda:aws:fulfill-prod',
          functionId: 'function:src/fulfill.ts:handler',
          confidence: 'proven',
          handlerSource: 'declared',
          handlerDrift: 'not_checked',
        },
      ],
      unresolved: [],
    });
  });

  it('records no_match when the declared handler names nothing scanned', () => {
    const g: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:fulfill-prod', type: 'lambda', name: 'fulfill-prod' },
        {
          id: 'function:src/ship.ts:handler',
          type: 'function',
          name: 'handler',
          file: 'src/ship.ts',
        },
      ],
      edges: [],
    };
    expect(new HandlerLinker(iac).link(g).unresolved).toEqual([
      { lambdaId: 'lambda:aws:fulfill-prod', reason: 'no_match', candidates: [] },
    ]);
  });

  it('does not link when the lambda node is absent', () => {
    const g: SystemGraph = {
      nodes: [
        {
          id: 'function:src/fulfill.ts:handler',
          type: 'function',
          name: 'handler',
          file: 'src/fulfill.ts',
        },
      ],
      edges: [],
    };
    expect(new HandlerLinker(iac).link(g)).toEqual({ links: [], unresolved: [] });
  });
});

describe('compositeLink', () => {
  it('prefers proven and only fills uncovered lambdas with heuristic', () => {
    const g: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:fulfill-prod', type: 'lambda', name: 'fulfill-prod' },
        {
          id: 'function:src/fulfill.ts:handler',
          type: 'function',
          name: 'handler',
          file: 'src/fulfill.ts',
        },
        { id: 'lambda:aws:ship', type: 'lambda', name: 'ship' },
        { id: 'function:src/ship.ts:ship', type: 'function', name: 'ship', file: 'src/ship.ts' },
      ],
      edges: [],
    };
    const iac: IaCLambda[] = [
      {
        name: 'fulfill-prod',
        handler: 'src/fulfill.handler',
        source: 'terraform',
        filePath: 'main.tf',
      },
    ];
    const { links, unresolved } = compositeLink(iac, g);
    expect(unresolved).toEqual([]);
    expect(links).toContainEqual({
      lambdaId: 'lambda:aws:fulfill-prod',
      functionId: 'function:src/fulfill.ts:handler',
      confidence: 'proven',
      handlerSource: 'declared',
      handlerDrift: 'not_checked',
    });
    expect(links).toContainEqual({
      lambdaId: 'lambda:aws:ship',
      functionId: 'function:src/ship.ts:ship',
      confidence: 'inferred',
    });
    expect(links).toHaveLength(2);
  });

  it('returns one unresolved record per unlinked Lambda, preferring the IaC reason', () => {
    const g: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:fulfill-prod', type: 'lambda', name: 'fulfill-prod' },
        { id: 'function:a.ts:fulfill', type: 'function', name: 'fulfill', file: 'a.ts' },
        { id: 'function:b.ts:fulfill', type: 'function', name: 'fulfill', file: 'b.ts' },
      ],
      edges: [],
    };
    const iac: IaCLambda[] = [
      {
        name: 'fulfill-prod',
        handler: 'src/fulfill.handler',
        source: 'terraform',
        filePath: 'main.tf',
      },
    ];
    // The heuristic sees two `fulfill` functions; the declared handler matches
    // neither, and the declaration is what the deployment runs.
    expect(new HeuristicLinker().link(g).unresolved[0]?.reason).toBe('multiple_functions');
    expect(compositeLink(iac, g)).toEqual({
      links: [],
      unresolved: [{ lambdaId: 'lambda:aws:fulfill-prod', reason: 'no_match', candidates: [] }],
    });
  });
});

const fnNode = (file: string, name = 'handler') => ({
  id: `function:${file}:${name}`,
  type: 'function' as const,
  name,
  file,
});
const lamNode = (name: string, handler?: string) => ({
  id: `lambda:aws:${name}`,
  type: 'lambda' as const,
  name,
  ...(handler === undefined ? {} : { handler }),
});
const iacLambda = (name: string, handler?: string): IaCLambda => ({
  name,
  handler,
  source: 'terraform',
  filePath: 'main.tf',
});

describe('HandlerLinker - deployed handler is the authority', () => {
  it('resolves the deployed handler and records the disagreement with the declaration', () => {
    const g: SystemGraph = {
      nodes: [
        lamNode('orders-prod', 'orders.handler'),
        fnNode('src/index.ts'),
        fnNode('src/orders.ts'),
      ],
      edges: [],
    };
    expect(new HandlerLinker([iacLambda('orders-prod', 'index.handler')]).link(g)).toEqual({
      links: [
        {
          lambdaId: 'lambda:aws:orders-prod',
          functionId: 'function:src/orders.ts:handler',
          confidence: 'proven',
          handlerSource: 'deployed',
          handlerDrift: 'modified',
        },
      ],
      unresolved: [],
    });
  });

  it('records in_sync when both sources name the same handler', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders-prod', 'orders.handler'), fnNode('src/orders.ts')],
      edges: [],
    };
    const { links } = new HandlerLinker([iacLambda('orders-prod', 'orders.handler')]).link(g);
    expect(links[0]?.handlerDrift).toBe('in_sync');
  });

  it('resolves a deployed handler with no IaC at all', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders-prod', 'orders.handler'), fnNode('src/orders.ts')],
      edges: [],
    };
    expect(new HandlerLinker([]).link(g)).toEqual({
      links: [
        {
          lambdaId: 'lambda:aws:orders-prod',
          functionId: 'function:src/orders.ts:handler',
          confidence: 'proven',
          handlerSource: 'deployed',
          handlerDrift: 'not_checked',
        },
      ],
      unresolved: [],
    });
  });

  it('falls back to the declaration when the deployed handler names unscanned code', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders-prod', 'ghost.handler'), fnNode('src/orders.ts')],
      edges: [],
    };
    expect(new HandlerLinker([iacLambda('orders-prod', 'orders.handler')]).link(g)).toEqual({
      links: [
        {
          lambdaId: 'lambda:aws:orders-prod',
          functionId: 'function:src/orders.ts:handler',
          confidence: 'proven',
          handlerSource: 'declared',
          handlerDrift: 'modified',
        },
      ],
      unresolved: [],
    });
  });

  it('records no_match when neither source resolves', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders-prod', 'ghost.handler'), fnNode('src/orders.ts')],
      edges: [],
    };
    expect(new HandlerLinker([iacLambda('orders-prod', 'missing.handler')]).link(g)).toEqual({
      links: [],
      unresolved: [{ lambdaId: 'lambda:aws:orders-prod', reason: 'no_match', candidates: [] }],
    });
  });

  it('records multiple_functions when the deployed handler matches several files', () => {
    const g: SystemGraph = {
      nodes: [
        lamNode('orders-prod', 'orders.handler'),
        fnNode('a/orders.ts'),
        fnNode('b/orders.ts'),
      ],
      edges: [],
    };
    expect(new HandlerLinker([]).link(g).unresolved).toEqual([
      {
        lambdaId: 'lambda:aws:orders-prod',
        reason: 'multiple_functions',
        candidates: ['function:a/orders.ts:handler', 'function:b/orders.ts:handler'],
      },
    ]);
  });

  it('resolves a Python handler through a .py file', () => {
    const g: SystemGraph = {
      nodes: [lamNode('jobs', 'main.handler'), fnNode('jobs/main.py')],
      edges: [],
    };
    expect(new HandlerLinker([]).link(g).links).toEqual([
      {
        lambdaId: 'lambda:aws:jobs',
        functionId: 'function:jobs/main.py:handler',
        confidence: 'proven',
        handlerSource: 'deployed',
        handlerDrift: 'not_checked',
      },
    ]);
  });

  it('resolves a Python handler when the scanner reported a backslash path', () => {
    const g: SystemGraph = {
      nodes: [lamNode('jobs', 'main.handler'), fnNode('D:\\repo\\jobs\\main.py')],
      edges: [],
    };
    expect(new HandlerLinker([]).link(g).links[0]?.functionId).toBe(
      'function:D:\\repo\\jobs\\main.py:handler',
    );
  });
});

describe('compositeLink - a read handler outranks the name heuristic', () => {
  it('refuses a name match when the deployed handler names unscanned code', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders', 'ghost.handler'), fnNode('src/orders.ts')],
      edges: [],
    };
    expect(compositeLink([], g)).toEqual({
      links: [],
      unresolved: [{ lambdaId: 'lambda:aws:orders', reason: 'no_match', candidates: [] }],
    });
  });

  it('keeps the declared link when only the deployment disagrees', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders', 'ghost.handler'), fnNode('src/orders.ts')],
      edges: [],
    };
    expect(compositeLink([iacLambda('orders', 'orders.handler')], g).links[0]?.confidence).toBe(
      'proven',
    );
  });

  it('still fills a name match when only the declaration was read and it failed', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders'), fnNode('src/orders.ts')],
      edges: [],
    };
    expect(compositeLink([iacLambda('orders', 'missing.handler')], g).links).toEqual([
      {
        lambdaId: 'lambda:aws:orders',
        functionId: 'function:src/orders.ts:handler',
        confidence: 'inferred',
      },
    ]);
  });

  it('leaves a placeholder Lambda with no handler to the name heuristic', () => {
    const g: SystemGraph = { nodes: [lamNode('orders'), fnNode('src/orders.ts')], edges: [] };
    expect(compositeLink([], g).links).toEqual([
      {
        lambdaId: 'lambda:aws:orders',
        functionId: 'function:src/orders.ts:handler',
        confidence: 'inferred',
      },
    ]);
  });
});

describe('linkers - indexed lookup keeps graph order', () => {
  it('names candidates in graph order when one matches by file and another by name', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders'), fnNode('/repo/orders.ts', 'x'), fnNode('/repo/a.ts', 'orders')],
      edges: [],
    };
    expect(compositeLink([], g).unresolved).toEqual([
      {
        lambdaId: 'lambda:aws:orders',
        reason: 'multiple_functions',
        candidates: ['function:/repo/orders.ts:x', 'function:/repo/a.ts:orders'],
      },
    ]);
  });

  it('counts a function whose name and file normalise to one key once', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders'), fnNode('/repo/orders.ts', 'orders')],
      edges: [],
    };
    expect(compositeLink([], g).links).toEqual([
      {
        lambdaId: 'lambda:aws:orders',
        functionId: 'function:/repo/orders.ts:orders',
        confidence: 'inferred',
      },
    ]);
  });

  it('does not match on an empty normalised key', () => {
    const g: SystemGraph = {
      nodes: [lamNode('handler'), fnNode('/repo/handler.ts', 'fn')],
      edges: [],
    };
    expect(compositeLink([], g).unresolved).toEqual([
      { lambdaId: 'lambda:aws:handler', reason: 'no_match', candidates: [] },
    ]);
  });

  it('links every Lambda in a large graph, in graph order', () => {
    const nodes: SystemGraph['nodes'] = [];
    for (let i = 0; i < 500; i++) {
      nodes.push(lamNode(`svc-${i}`, `file${i}.export${i}`));
      nodes.push(fnNode(`/repo/file${i}.ts`, `export${i}`));
    }
    const { links } = compositeLink([], { nodes, edges: [] });
    expect(links).toHaveLength(500);
    expect(links[0]?.functionId).toBe('function:/repo/file0.ts:export0');
    expect(links[499]?.functionId).toBe('function:/repo/file499.ts:export499');
  });
});

describe('HandlerLinker - drift is a property of the declarations, not of file order', () => {
  const graph = (): SystemGraph => ({
    nodes: [lamNode('orders', 'orders.handler'), fnNode('src/orders.ts')],
    edges: [],
  });

  it('reports modified for duplicate declarations that disagree, in either order', () => {
    const a = new HandlerLinker([
      iacLambda('orders', 'index.handler'),
      iacLambda('orders', 'orders.handler'),
    ]).link(graph());
    const b = new HandlerLinker([
      iacLambda('orders', 'orders.handler'),
      iacLambda('orders', 'index.handler'),
    ]).link(graph());
    expect(a.links[0]?.handlerDrift).toBe('modified');
    expect(b.links[0]?.handlerDrift).toBe('modified');
  });

  it('compares resolved identities, so a leading ./ is not a disagreement', () => {
    const { links } = new HandlerLinker([iacLambda('orders', './orders.handler')]).link(graph());
    expect(links[0]?.handlerDrift).toBe('in_sync');
  });

  it('treats an empty handler string as never read', () => {
    const g: SystemGraph = {
      nodes: [lamNode('orders', ''), fnNode('src/orders.ts')],
      edges: [],
    };
    expect(compositeLink([], g)).toEqual({
      links: [
        {
          lambdaId: 'lambda:aws:orders',
          functionId: 'function:src/orders.ts:handler',
          confidence: 'inferred',
        },
      ],
      unresolved: [],
    });
  });
});
