/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';
import type { SystemGraph } from '../../types.js';
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
    const analyzer = new PipelineAnalyzer();
    analyzer.setIaCLambdas(iac);
    const findings = await analyzer.analyze(graph);
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
    const analyzer = new PipelineAnalyzer();
    const findings = await analyzer.analyze(graph);
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
    const analyzer = new PipelineAnalyzer();
    const findings = await analyzer.analyze(graph);
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
    const findings = await new PipelineAnalyzer().analyze(graph);
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
    const findings = await new PipelineAnalyzer().analyze(graph);
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
    const analyzer = new PipelineAnalyzer();
    analyzer.setIaCLambdas([
      {
        name: 'consume-prod',
        handler: 'src/consume.handler',
        source: 'terraform',
        filePath: 'm.tf',
      },
    ]);
    const findings = await analyzer.analyze(graph);
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
    const analyzer = new PipelineAnalyzer();
    analyzer.setIaCLambdas([
      { name: 'consume-prod', handler: 'consume.handler', source: 'terraform', filePath: 'm.tf' },
    ]);
    const findings = await analyzer.analyze(graph);
    expect(findings.filter((f) => f.issue.includes('multiple stages'))).toHaveLength(1);
  });

  it('does not flag a table read by only one function', async () => {
    const graph = pipelineGraph({
      consumerLambda: 'consume-prod',
      consumerFnName: 'handler',
      consumerFnFile: 'src/consume.ts',
      dlq: true,
    });
    const analyzer = new PipelineAnalyzer();
    analyzer.setIaCLambdas([
      {
        name: 'consume-prod',
        handler: 'src/consume.handler',
        source: 'terraform',
        filePath: 'm.tf',
      },
    ]);
    const findings = await analyzer.analyze(graph);
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
    const findings = await new PipelineAnalyzer().analyze(graph);
    const repeated = findings.filter((f) => f.issue.includes('multiple stages'));
    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.severity).toBe('verify');
  });
});
