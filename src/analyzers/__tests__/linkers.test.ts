import { describe, it, expect } from 'vitest';
import type { SystemGraph } from '../../types.js';
import type { IaCLambda } from '../../adapters/iac/terraform.js';
import { normalizeName, HeuristicLinker, IaCHandlerLinker, CompositeLinker } from '../linkers.js';

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
    const links = new HeuristicLinker().link(
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
    const links = new HeuristicLinker().link(graphWith('orders', 'handler', 'src/orders.ts'));
    expect(links).toEqual([
      {
        lambdaId: 'lambda:aws:orders',
        functionId: 'function:src/orders.ts:handler',
        confidence: 'inferred',
      },
    ]);
  });

  it('does not link when nothing matches', () => {
    expect(new HeuristicLinker().link(graphWith('alpha', 'beta', 'src/beta.ts'))).toEqual([]);
  });

  it('does not link when multiple functions match (ambiguous)', () => {
    const g: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:orders', type: 'lambda', name: 'orders' },
        { id: 'function:a.ts:orders', type: 'function', name: 'orders', file: 'a.ts' },
        { id: 'function:b.ts:orders', type: 'function', name: 'orders', file: 'b.ts' },
      ],
      edges: [],
    };
    expect(new HeuristicLinker().link(g)).toEqual([]);
  });
});

describe('IaCHandlerLinker', () => {
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
    expect(new IaCHandlerLinker(iac).link(g)).toEqual([
      {
        lambdaId: 'lambda:aws:fulfill-prod',
        functionId: 'function:src/fulfill.ts:handler',
        confidence: 'proven',
      },
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
    expect(new IaCHandlerLinker(iac).link(g)).toEqual([]);
  });
});

describe('CompositeLinker', () => {
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
    const links = new CompositeLinker(new IaCHandlerLinker(iac), new HeuristicLinker()).link(g);
    expect(links).toContainEqual({
      lambdaId: 'lambda:aws:fulfill-prod',
      functionId: 'function:src/fulfill.ts:handler',
      confidence: 'proven',
    });
    expect(links).toContainEqual({
      lambdaId: 'lambda:aws:ship',
      functionId: 'function:src/ship.ts:ship',
      confidence: 'inferred',
    });
    expect(links).toHaveLength(2);
  });
});
