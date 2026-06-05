import { describe, it, expect } from 'vitest';
import {
  MissingDLQAnalyzer,
  UnencryptedQueueAnalyzer,
  LargeQueueBacklogAnalyzer,
  MissingSecretRotationAnalyzer,
  MissingLogRetentionAnalyzer,
  LambdaDefaultMemoryAnalyzer,
  LambdaHighTimeoutAnalyzer,
  LambdaMissingTriggerDLQAnalyzer,
  S3PublicAccessAnalyzer,
  S3MissingVersioningAnalyzer,
  S3UnencryptedAnalyzer,
} from '../aws-services';
import type { SystemGraph } from '../../types';

describe('MissingDLQAnalyzer', () => {
  const analyzer = new MissingDLQAnalyzer();

  it('flags queue without a DLQ', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: false,
          encrypted: true,
        },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].issue).toContain('orders');
  });

  it('does not flag queue that has a DLQ', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('ignores non-queue nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('flags multiple queues missing DLQs', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:a',
          type: 'queue',
          name: 'a',
          provider: 'aws',
          hasDLQ: false,
          encrypted: true,
        },
        {
          id: 'queue:aws:b',
          type: 'queue',
          name: 'b',
          provider: 'aws',
          hasDLQ: false,
          encrypted: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(2);
  });
});

describe('UnencryptedQueueAnalyzer', () => {
  const analyzer = new UnencryptedQueueAnalyzer();

  it('flags unencrypted queue', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          encrypted: false,
        },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
    expect(findings[0].issue).toContain('orders');
  });

  it('does not flag encrypted queue', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('returns empty findings for empty graph', async () => {
    expect(await analyzer.analyze({ nodes: [], edges: [] })).toHaveLength(0);
  });
});

describe('LargeQueueBacklogAnalyzer', () => {
  it('flags queue above default threshold (1000)', async () => {
    const analyzer = new LargeQueueBacklogAnalyzer();
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
          approximateMessages: 1500,
        },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].metadata?.messageCount).toBe(1500);
  });

  it('does not flag queue below threshold', async () => {
    const analyzer = new LargeQueueBacklogAnalyzer();
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
          approximateMessages: 500,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('respects custom threshold', async () => {
    const analyzer = new LargeQueueBacklogAnalyzer(100);
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
          approximateMessages: 101,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(1);
  });

  it('treats missing approximateMessages as 0', async () => {
    const analyzer = new LargeQueueBacklogAnalyzer();
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('MissingSecretRotationAnalyzer', () => {
  const analyzer = new MissingSecretRotationAnalyzer();

  it('flags secret without rotation', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'secret:aws:db-password',
          type: 'secret',
          name: 'db-password',
          provider: 'aws',
          rotationEnabled: false,
        },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('db-password');
  });

  it('does not flag secret with rotation enabled', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'secret:aws:db-password',
          type: 'secret',
          name: 'db-password',
          provider: 'aws',
          rotationEnabled: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('ignores non-secret nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('MissingLogRetentionAnalyzer', () => {
  const analyzer = new MissingLogRetentionAnalyzer();

  it('flags log group with no retention policy', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'log_group:aws:/app/api', type: 'log_group', name: '/app/api', provider: 'aws' },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('/app/api');
  });

  it('flags log group with retention over 365 days', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'log_group:aws:/app/api',
          type: 'log_group',
          name: '/app/api',
          provider: 'aws',
          retentionDays: 400,
        },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
    expect(findings[0].metadata?.retentionDays).toBe(400);
  });

  it('does not flag log group with reasonable retention', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'log_group:aws:/app/api',
          type: 'log_group',
          name: '/app/api',
          provider: 'aws',
          retentionDays: 90,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('does not flag retention exactly at 365 days', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'log_group:aws:/app/api',
          type: 'log_group',
          name: '/app/api',
          provider: 'aws',
          retentionDays: 365,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('ignores non-log-group nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('LambdaDefaultMemoryAnalyzer', () => {
  const analyzer = new LambdaDefaultMemoryAnalyzer();

  it('flags Lambda with default 128 MB memory', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', memoryMB: 128 },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
    expect(findings[0].issue).toContain('processOrders');
    expect(findings[0].metadata?.memoryMB).toBe(128);
  });

  it('does not flag Lambda with higher memory', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', memoryMB: 512 },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('ignores non-lambda nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('LambdaMissingTriggerDLQAnalyzer', () => {
  const analyzer = new LambdaMissingTriggerDLQAnalyzer();

  it('flags Lambda triggered by SQS queue with no DLQ', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'lambda:aws:processOrders',
          type: 'lambda',
          name: 'processOrders',
          triggers: [
            {
              type: 'sqs',
              sourceArn: 'arn:aws:sqs:us-east-1:000:orders-queue',
              sourceName: 'orders-queue',
              eventShape: 'event.Records[0].body',
            },
          ],
        },
        {
          id: 'queue:aws:orders-queue',
          type: 'queue',
          name: 'orders-queue',
          provider: 'aws',
          hasDLQ: false,
          encrypted: true,
        },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].issue).toContain('processOrders');
    expect(findings[0].issue).toContain('orders-queue');
    expect(findings[0].metadata?.triggerType).toBe('sqs');
  });

  it('does not flag Lambda triggered by SQS queue that has a DLQ', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'lambda:aws:processOrders',
          type: 'lambda',
          name: 'processOrders',
          triggers: [
            {
              type: 'sqs',
              sourceArn: 'arn:aws:sqs:us-east-1:000:orders-queue',
              sourceName: 'orders-queue',
              eventShape: 'event.Records[0].body',
            },
          ],
        },
        {
          id: 'queue:aws:orders-queue',
          type: 'queue',
          name: 'orders-queue',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('does not flag Lambda with no triggers', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', triggers: [] },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('does not flag Lambda triggered by EventBridge', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'lambda:aws:generateReport',
          type: 'lambda',
          name: 'generateReport',
          triggers: [
            {
              type: 'eventbridge',
              sourceArn: 'arn:aws:events:us-east-1:000:rule/schedule',
              sourceName: 'schedule',
              eventShape: 'event.detail',
              ruleName: 'schedule',
            },
          ],
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('does not flag when trigger source queue is not in the graph', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'lambda:aws:processOrders',
          type: 'lambda',
          name: 'processOrders',
          triggers: [
            {
              type: 'sqs',
              sourceArn: 'arn:aws:sqs:us-east-1:000:unknown-queue',
              sourceName: 'unknown-queue',
              eventShape: 'event.Records[0].body',
            },
          ],
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('ignores non-lambda nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('LambdaHighTimeoutAnalyzer', () => {
  const analyzer = new LambdaHighTimeoutAnalyzer();

  it('flags Lambda with timeout >= 300s', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', timeoutSec: 300 },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
    expect(findings[0].metadata?.timeoutSec).toBe(300);
  });

  it('flags Lambda with timeout above 300s', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', timeoutSec: 900 },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(1);
  });

  it('does not flag Lambda with timeout below 300s', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', timeoutSec: 30 },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('treats missing timeoutSec as 0', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders' }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('S3PublicAccessAnalyzer', () => {
  const analyzer = new S3PublicAccessAnalyzer();

  it('flags bucket with public access not blocked', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'bucket:aws:assets',
          type: 'bucket',
          name: 'assets',
          provider: 'aws',
          versioned: true,
          encrypted: true,
          publicAccessBlocked: false,
        },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('verify');
    expect(findings[0].issue).toContain('assets');
    expect(findings[0].metadata?.bucketName).toBe('assets');
  });

  it('does not flag bucket with public access blocked', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'bucket:aws:assets',
          type: 'bucket',
          name: 'assets',
          provider: 'aws',
          versioned: true,
          encrypted: true,
          publicAccessBlocked: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('ignores non-bucket nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('S3MissingVersioningAnalyzer', () => {
  const analyzer = new S3MissingVersioningAnalyzer();

  it('flags bucket with versioning disabled', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'bucket:aws:assets',
          type: 'bucket',
          name: 'assets',
          provider: 'aws',
          versioned: false,
          encrypted: true,
          publicAccessBlocked: true,
        },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('assets');
    expect(findings[0].metadata?.bucketName).toBe('assets');
  });

  it('does not flag bucket with versioning enabled', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'bucket:aws:assets',
          type: 'bucket',
          name: 'assets',
          provider: 'aws',
          versioned: true,
          encrypted: true,
          publicAccessBlocked: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('ignores non-bucket nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('S3UnencryptedAnalyzer', () => {
  const analyzer = new S3UnencryptedAnalyzer();

  it('flags bucket without server-side encryption', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'bucket:aws:assets',
          type: 'bucket',
          name: 'assets',
          provider: 'aws',
          versioned: true,
          encrypted: false,
          publicAccessBlocked: true,
        },
      ],
      edges: [],
    };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('assets');
    expect(findings[0].metadata?.bucketName).toBe('assets');
  });

  it('does not flag bucket with encryption configured', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'bucket:aws:assets',
          type: 'bucket',
          name: 'assets',
          provider: 'aws',
          versioned: true,
          encrypted: true,
          publicAccessBlocked: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('ignores non-bucket nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});
