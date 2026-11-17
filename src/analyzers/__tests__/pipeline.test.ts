import { describe, it, expect } from 'vitest';
import type { Finding, SystemGraph } from '../../types.js';
import type { IaCLambda } from '../../adapters/iac/terraform.js';
import { PipelineAnalyzer } from '../pipeline.js';

// producer fn -> queue -> lambda consumer; consumer code scans a table.
function pipelineGraph(opts: {
  consumerLambda: string;
  consumerFnName: string;
  consumerFnFile: string;
  dlq: boolean;
}): SystemGraph {
  return {
    nodes: [
      {
        id: 'function:src/producer.ts:produce',
        type: 'function',
        name: 'produce',
        file: 'src/producer.ts',
      },
      {
        id: 'queue:aws:order-events',
        type: 'queue',
        name: 'order-events',
        provider: 'aws',
        hasDLQ: opts.dlq,
        encrypted: true,
      },
      { id: `lambda:aws:${opts.consumerLambda}`, type: 'lambda', name: opts.consumerLambda },
      {
        id: `function:${opts.consumerFnFile}:${opts.consumerFnName}`,
        type: 'function',
        name: opts.consumerFnName,
        file: opts.consumerFnFile,
      },
      { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
    ],
    edges: [
      {
        from: 'function:src/producer.ts:produce',
        to: 'queue:aws:order-events',
        type: 'publishes_to',
      },
      { from: 'queue:aws:order-events', to: `lambda:aws:${opts.consumerLambda}`, type: 'triggers' },
      {
        from: `function:${opts.consumerFnFile}:${opts.consumerFnName}`,
        to: 'table:dynamo:Orders',
        type: 'scan',
      },
    ],
  };
}

describe('PipelineAnalyzer — scan in pipeline', () => {
  it('emits HIGH when the lambda-to-code link is proven from IaC', async () => {
    const graph = pipelineGraph({
      consumerLambda: 'fulfill-prod',
      consumerFnName: 'handler',
      consumerFnFile: 'src/fulfill.ts',
      dlq: true,
    });
    const iac: IaCLambda[] = [
      {
        name: 'fulfill-prod',
        handler: 'src/fulfill.handler',
        source: 'terraform',
        filePath: 'main.tf',
      },
    ];
    const analyzer = (g: SystemGraph) => PipelineAnalyzer(g, iac);
    const findings = await analyzer(graph);
    const scan = findings.filter((f) => f.issue.includes('Full scan runs inside'));
    expect(scan).toHaveLength(1);
    expect(scan[0]!.severity).toBe('high');
  });

  it('caps to VERIFY when the link is heuristic (no IaC)', async () => {
    const graph = pipelineGraph({
      consumerLambda: 'fulfill',
      consumerFnName: 'fulfill',
      consumerFnFile: 'src/fulfill.ts',
      dlq: true,
    });
    const analyzer = PipelineAnalyzer;
    const findings = await analyzer(graph);
    const scan = findings.filter((f) => f.issue.includes('Full scan runs inside'));
    expect(scan).toHaveLength(1);
    expect(scan[0]!.severity).toBe('verify');
  });

  it('emits nothing when no link can be made (false-positive guard)', async () => {
    const graph = pipelineGraph({
      consumerLambda: 'alpha',
      consumerFnName: 'beta',
      consumerFnFile: 'src/beta.ts',
      dlq: true,
    });
    const analyzer = PipelineAnalyzer;
    const findings = await analyzer(graph);
    expect(findings.filter((f) => f.issue.includes('Full scan runs inside'))).toHaveLength(0);
  });
});

describe('PipelineAnalyzer — missing DLQ hop', () => {
  it('flags a mid-pipeline queue with no DLQ at medium', async () => {
    const graph = pipelineGraph({
      consumerLambda: 'alpha',
      consumerFnName: 'beta',
      consumerFnFile: 'src/beta.ts',
      dlq: false,
    });
    const findings = await PipelineAnalyzer(graph);
    const dlq = findings.filter((f) => f.issue.includes('mid-pipeline'));
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.severity).toBe('medium');
  });

  it('does not flag when the queue has a DLQ', async () => {
    const graph = pipelineGraph({
      consumerLambda: 'alpha',
      consumerFnName: 'beta',
      consumerFnFile: 'src/beta.ts',
      dlq: true,
    });
    const findings = await PipelineAnalyzer(graph);
    expect(findings.filter((f) => f.issue.includes('mid-pipeline'))).toHaveLength(0);
  });
});

describe('PipelineAnalyzer — repeated table access across a pipeline', () => {
  it('flags a table read by two functions in the same proven pipeline at medium', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'function:src/producer.ts:produce',
          type: 'function',
          name: 'produce',
          file: 'src/producer.ts',
        },
        {
          id: 'queue:aws:q',
          type: 'queue',
          name: 'q',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
        },
        { id: 'lambda:aws:consume-prod', type: 'lambda', name: 'consume-prod' },
        {
          id: 'function:src/consume.ts:handler',
          type: 'function',
          name: 'handler',
          file: 'src/consume.ts',
        },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ],
      edges: [
        { from: 'function:src/producer.ts:produce', to: 'queue:aws:q', type: 'publishes_to' },
        { from: 'queue:aws:q', to: 'lambda:aws:consume-prod', type: 'triggers' },
        { from: 'function:src/producer.ts:produce', to: 'table:dynamo:Orders', type: 'query' },
        { from: 'function:src/consume.ts:handler', to: 'table:dynamo:Orders', type: 'query' },
      ],
    };
    const analyzer = (g: SystemGraph) =>
      PipelineAnalyzer(g, [
        {
          name: 'consume-prod',
          handler: 'src/consume.handler',
          source: 'terraform',
          filePath: 'm.tf',
        },
      ]);
    const findings = await analyzer(graph);
    const repeated = findings.filter((f) => f.issue.includes('multiple stages'));
    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.severity).toBe('medium');
  });

  it('still flags repeated access when a function file path contains a space', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'function:/Users/john doe/producer.ts:produce',
          type: 'function',
          name: 'produce',
          file: '/Users/john doe/producer.ts',
        },
        {
          id: 'queue:aws:q',
          type: 'queue',
          name: 'q',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
        },
        { id: 'lambda:aws:consume-prod', type: 'lambda', name: 'consume-prod' },
        {
          id: 'function:/Users/john doe/consume.ts:handler',
          type: 'function',
          name: 'handler',
          file: '/Users/john doe/consume.ts',
        },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ],
      edges: [
        {
          from: 'function:/Users/john doe/producer.ts:produce',
          to: 'queue:aws:q',
          type: 'publishes_to',
        },
        { from: 'queue:aws:q', to: 'lambda:aws:consume-prod', type: 'triggers' },
        {
          from: 'function:/Users/john doe/producer.ts:produce',
          to: 'table:dynamo:Orders',
          type: 'query',
        },
        {
          from: 'function:/Users/john doe/consume.ts:handler',
          to: 'table:dynamo:Orders',
          type: 'query',
        },
      ],
    };
    const analyzer = (g: SystemGraph) =>
      PipelineAnalyzer(g, [
        { name: 'consume-prod', handler: 'consume.handler', source: 'terraform', filePath: 'm.tf' },
      ]);
    const findings = await analyzer(graph);
    expect(findings.filter((f) => f.issue.includes('multiple stages'))).toHaveLength(1);
  });

  it('does not flag a table read by only one function', async () => {
    const graph = pipelineGraph({
      consumerLambda: 'consume-prod',
      consumerFnName: 'handler',
      consumerFnFile: 'src/consume.ts',
      dlq: true,
    });
    const analyzer = (g: SystemGraph) =>
      PipelineAnalyzer(g, [
        {
          name: 'consume-prod',
          handler: 'src/consume.handler',
          source: 'terraform',
          filePath: 'm.tf',
        },
      ]);
    const findings = await analyzer(graph);
    expect(findings.filter((f) => f.issue.includes('multiple stages'))).toHaveLength(0);
  });

  it('caps repeated access to VERIFY when the pipeline link is heuristic', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'function:src/producer.ts:produce',
          type: 'function',
          name: 'produce',
          file: 'src/producer.ts',
        },
        {
          id: 'queue:aws:q',
          type: 'queue',
          name: 'q',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
        },
        { id: 'lambda:aws:consume', type: 'lambda', name: 'consume' },
        {
          id: 'function:src/consume.ts:consume',
          type: 'function',
          name: 'consume',
          file: 'src/consume.ts',
        },
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ],
      edges: [
        { from: 'function:src/producer.ts:produce', to: 'queue:aws:q', type: 'publishes_to' },
        { from: 'queue:aws:q', to: 'lambda:aws:consume', type: 'triggers' },
        { from: 'function:src/producer.ts:produce', to: 'table:dynamo:Orders', type: 'query' },
        { from: 'function:src/consume.ts:consume', to: 'table:dynamo:Orders', type: 'query' },
      ],
    };
    // no setIaCLambdas -> only the heuristic linker can connect lambda:consume to function consume
    const findings = await PipelineAnalyzer(graph);
    const repeated = findings.filter((f) => f.issue.includes('multiple stages'));
    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.severity).toBe('verify');
  });
});

// One source function, several deployments. `index.handler` declared by each
// Lambda is the ordinary shared-entrypoint shape, not a normalization edge case.
const SHARED_FN = 'function:src/orders/index.ts:handler';

function sharedHandlerGraph(lambdaNames: string[]): SystemGraph {
  return {
    nodes: [
      { id: SHARED_FN, type: 'function', name: 'handler', file: 'src/orders/index.ts' },
      { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
      ...lambdaNames.map((n) => ({ id: `lambda:aws:${n}`, type: 'lambda' as const, name: n })),
    ],
    edges: [
      ...lambdaNames.map((n) => ({
        from: 'queue:aws:order-events',
        to: `lambda:aws:${n}`,
        type: 'triggers' as const,
      })),
      { from: SHARED_FN, to: 'table:dynamo:Orders', type: 'scan' as const },
    ],
  };
}

const sharedHandlerIac = (lambdaNames: string[]): IaCLambda[] =>
  lambdaNames.map((n) => ({
    name: n,
    handler: 'src/orders/index.handler',
    source: 'terraform' as const,
    filePath: 'main.tf',
  }));

const scanFindings = (findings: Finding[]) =>
  findings.filter((f) => f.issue.includes('Full scan runs inside'));

describe('PipelineAnalyzer - several Lambdas share one handler', () => {
  it('names every linked Lambda in one finding at HIGH when all links are proven', async () => {
    const names = ['orders-prod', 'orders-reindex', 'orders-legacy'];
    const findings = scanFindings(
      await PipelineAnalyzer(sharedHandlerGraph(names), sharedHandlerIac(names)),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('high');
    expect(findings[0]!.metadata?.lambdas).toEqual([
      { lambda: 'orders-legacy', confidence: 'proven' },
      { lambda: 'orders-prod', confidence: 'proven' },
      { lambda: 'orders-reindex', confidence: 'proven' },
    ]);
    expect(findings[0]!.issue).toContain('3 event-triggered Lambdas');
    for (const name of names) expect(findings[0]!.issue).toContain(`"${name}" (proven)`);
  });

  it('keeps HIGH when one link is proven and another is inferred, marking each name', async () => {
    const graph = sharedHandlerGraph(['orders-prod', 'index']);
    const findings = scanFindings(await PipelineAnalyzer(graph, sharedHandlerIac(['orders-prod'])));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('high');
    expect(findings[0]!.issue).toContain('"orders-prod" (proven)');
    expect(findings[0]!.issue).toContain('"index" (inferred)');
    expect(findings[0]!.description).toContain('verify them before acting');
  });

  it('caps to VERIFY when no link is proven', async () => {
    const findings = scanFindings(await PipelineAnalyzer(sharedHandlerGraph(['index']), []));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('verify');
    expect(findings[0]!.issue).toContain('"index" (inferred)');
  });

  it('produces identical output when the links arrive in another order', async () => {
    const names = ['orders-prod', 'orders-reindex', 'orders-legacy'];
    const forward = scanFindings(
      await PipelineAnalyzer(sharedHandlerGraph(names), sharedHandlerIac(names)),
    );
    const reversedGraph = sharedHandlerGraph(names);
    const reversed = scanFindings(
      await PipelineAnalyzer(
        { nodes: [...reversedGraph.nodes].reverse(), edges: [...reversedGraph.edges].reverse() },
        sharedHandlerIac([...names].reverse()),
      ),
    );
    expect(reversed).toEqual(forward);
  });

  it('names every Lambda in the text, not only in metadata', async () => {
    const names = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
    const findings = scanFindings(
      await PipelineAnalyzer(sharedHandlerGraph(names), sharedHandlerIac(names)),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.metadata?.lambdas).toHaveLength(7);
    for (const name of names) expect(findings[0]!.issue).toContain(`"${name}" (proven)`);
  });

  it('does not name a Lambda twice when IaC declares it twice', async () => {
    const names = ['orders-prod'];
    const findings = scanFindings(
      await PipelineAnalyzer(sharedHandlerGraph(names), [
        ...sharedHandlerIac(names),
        ...sharedHandlerIac(names),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.metadata?.lambdas).toEqual([
      { lambda: 'orders-prod', confidence: 'proven' },
    ]);
  });

  it('ignores a Lambda that shares the handler but has no trigger', async () => {
    const graph = sharedHandlerGraph(['orders-prod']);
    const findings = scanFindings(
      await PipelineAnalyzer(graph, [
        ...sharedHandlerIac(['orders-prod']),
        ...sharedHandlerIac(['orders-cron']),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.metadata?.lambdas).toEqual([
      { lambda: 'orders-prod', confidence: 'proven' },
    ]);
  });
});
