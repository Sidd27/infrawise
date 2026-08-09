import { describe, it, expect } from 'vitest';
import {
  MissingDLQAnalyzer,
  UnencryptedQueueAnalyzer,
  LargeQueueBacklogAnalyzer,
  VisibilityTimeoutMismatchAnalyzer,
  MissingSecretRotationAnalyzer,
  MissingLogRetentionAnalyzer,
  LambdaDefaultMemoryAnalyzer,
  LambdaHighTimeoutAnalyzer,
  LambdaMissingTriggerDLQAnalyzer,
  MissingPartialBatchResponseAnalyzer,
  LambdaUnboundedConcurrencyAnalyzer,
  ShortRetentionNoDLQAnalyzer,
  S3PublicAccessAnalyzer,
  S3MissingVersioningAnalyzer,
  S3UnencryptedAnalyzer,
  CacheTransitEncryptionAnalyzer,
  CacheSingleNodeAnalyzer,
  LambdaThrottlingAnalyzer,
  StaleQueueMessagesAnalyzer,
  CloudFrontInsecureViewerProtocolAnalyzer,
} from '../aws-services.js';
import type { SystemGraph } from '../../types.js';

describe('MissingDLQAnalyzer', () => {
  const analyzer = MissingDLQAnalyzer;

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
    const findings = await analyzer(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].issue).toContain('orders');
  });

  it("does not flag a queue that is itself another queue's DLQ target", async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          dlqArn: 'arn:aws:sqs:us-east-1:000000000000:orders-dlq',
          encrypted: true,
        },
        {
          id: 'queue:aws:orders-dlq',
          type: 'queue',
          name: 'orders-dlq',
          provider: 'aws',
          hasDLQ: false,
          encrypted: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('does not flag a placeholder queue that was never extracted', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:unknown',
          type: 'queue',
          name: 'unknown',
          provider: 'aws',
          hasDLQ: false,
          encrypted: false,
          placeholder: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('ignores non-queue nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
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
    expect(await analyzer(graph)).toHaveLength(2);
  });
});

describe('UnencryptedQueueAnalyzer', () => {
  const analyzer = UnencryptedQueueAnalyzer;

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
    const findings = await analyzer(graph);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('returns empty findings for empty graph', async () => {
    expect(await analyzer({ nodes: [], edges: [] })).toHaveLength(0);
  });
});

describe('LargeQueueBacklogAnalyzer', () => {
  it('flags queue above default threshold (1000)', async () => {
    const analyzer = LargeQueueBacklogAnalyzer;
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
    const findings = await analyzer(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].metadata?.messageCount).toBe(1500);
  });

  it('does not flag queue below threshold', async () => {
    const analyzer = LargeQueueBacklogAnalyzer;
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('respects custom threshold', async () => {
    const analyzer = (g: SystemGraph) => LargeQueueBacklogAnalyzer(g, 100);
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
    expect(await analyzer(graph)).toHaveLength(1);
  });

  it('treats missing approximateMessages as 0', async () => {
    const analyzer = LargeQueueBacklogAnalyzer;
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
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('VisibilityTimeoutMismatchAnalyzer', () => {
  const analyzer = VisibilityTimeoutMismatchAnalyzer;

  const graphWith = (visibilityTimeoutSec: number): SystemGraph => ({
    nodes: [
      {
        id: 'queue:aws:orders',
        type: 'queue',
        name: 'orders',
        provider: 'aws',
        hasDLQ: true,
        encrypted: true,
        visibilityTimeoutSec,
      },
      { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', timeoutSec: 30 },
    ],
    edges: [{ from: 'queue:aws:orders', to: 'lambda:aws:processOrders', type: 'triggers' }],
  });

  it('flags high when visibility timeout is below the Lambda timeout', async () => {
    const findings = await analyzer(graphWith(10));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].metadata?.recommendedVisibilityTimeoutSec).toBe(180);
  });

  it('flags medium when visibility timeout is between 1x and 6x the Lambda timeout', async () => {
    const findings = await analyzer(graphWith(60));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('less than 6×');
  });

  it('does not flag when visibility timeout is at least 6x the Lambda timeout', async () => {
    expect(await analyzer(graphWith(180))).toHaveLength(0);
  });
});

describe('MissingSecretRotationAnalyzer', () => {
  const analyzer = MissingSecretRotationAnalyzer;

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
    const findings = await analyzer(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].issue).toContain('db-password');
  });

  it('does not flag a placeholder secret that was never extracted', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'secret:aws:unknown',
          type: 'secret',
          name: 'unknown',
          provider: 'aws',
          rotationEnabled: false,
          placeholder: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('ignores non-secret nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('MissingLogRetentionAnalyzer', () => {
  const analyzer = MissingLogRetentionAnalyzer;

  it('flags log group with no retention policy', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'log_group:aws:/app/api', type: 'log_group', name: '/app/api', provider: 'aws' },
      ],
      edges: [],
    };
    const findings = await analyzer(graph);
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
    const findings = await analyzer(graph);
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
    expect(await analyzer(graph)).toHaveLength(0);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('ignores non-log-group nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('LambdaDefaultMemoryAnalyzer', () => {
  const analyzer = LambdaDefaultMemoryAnalyzer;

  it('flags Lambda with default 128 MB memory', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', memoryMB: 128 },
      ],
      edges: [],
    };
    const findings = await analyzer(graph);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('ignores non-lambda nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('LambdaMissingTriggerDLQAnalyzer', () => {
  const analyzer = LambdaMissingTriggerDLQAnalyzer;

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
    const findings = await analyzer(graph);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('does not flag Lambda with no triggers', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', triggers: [] },
      ],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
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
    expect(await analyzer(graph)).toHaveLength(0);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('ignores non-lambda nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('LambdaHighTimeoutAnalyzer', () => {
  const analyzer = LambdaHighTimeoutAnalyzer;

  it('flags Lambda with timeout >= 300s', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', timeoutSec: 300 },
      ],
      edges: [],
    };
    const findings = await analyzer(graph);
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
    expect(await analyzer(graph)).toHaveLength(1);
  });

  it('does not flag Lambda with timeout below 300s', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders', timeoutSec: 30 },
      ],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('treats missing timeoutSec as 0', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders' }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('S3PublicAccessAnalyzer', () => {
  const analyzer = S3PublicAccessAnalyzer;

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
    const findings = await analyzer(graph);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('ignores non-bucket nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('S3MissingVersioningAnalyzer', () => {
  const analyzer = S3MissingVersioningAnalyzer;

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
    const findings = await analyzer(graph);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('ignores non-bucket nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('S3UnencryptedAnalyzer', () => {
  const analyzer = S3UnencryptedAnalyzer;

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
    const findings = await analyzer(graph);
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
    expect(await analyzer(graph)).toHaveLength(0);
  });

  it('ignores non-bucket nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'fn:fn1', type: 'function', name: 'fn1', file: 'src/x.ts' }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('CacheTransitEncryptionAnalyzer', () => {
  const analyzer = CacheTransitEncryptionAnalyzer;

  it('flags cluster without transit encryption', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'cache_cluster:aws:sessions',
          type: 'cache_cluster',
          name: 'sessions',
          provider: 'aws',
          engine: 'redis',
          transitEncryption: false,
        },
      ],
      edges: [],
    };
    const findings = await analyzer(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
  });

  it('does not flag encrypted cluster', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'cache_cluster:aws:sessions',
          type: 'cache_cluster',
          name: 'sessions',
          provider: 'aws',
          engine: 'redis',
          transitEncryption: true,
        },
      ],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('CacheSingleNodeAnalyzer', () => {
  const analyzer = CacheSingleNodeAnalyzer;

  it('flags standalone single-node cluster', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'cache_cluster:aws:sessions',
          type: 'cache_cluster',
          name: 'sessions',
          provider: 'aws',
          engine: 'redis',
          numNodes: 1,
        },
      ],
      edges: [],
    };
    const findings = await analyzer(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
  });

  it('does not flag cluster in a replication group', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'cache_cluster:aws:sessions',
          type: 'cache_cluster',
          name: 'sessions',
          provider: 'aws',
          engine: 'redis',
          numNodes: 1,
          replicationGroupId: 'sessions-rg',
        },
      ],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('LambdaThrottlingAnalyzer', () => {
  const analyzer = LambdaThrottlingAnalyzer;

  it('flags lambda with recent throttles', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'lambda:aws:worker', type: 'lambda', name: 'worker', recentThrottles: 12 }],
      edges: [],
    };
    const findings = await analyzer(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
  });

  it('does not flag lambda with zero throttles', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'lambda:aws:worker', type: 'lambda', name: 'worker', recentThrottles: 0 }],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('StaleQueueMessagesAnalyzer', () => {
  const analyzer = StaleQueueMessagesAnalyzer;

  it('flags queue whose oldest message exceeds one hour', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
          oldestMessageAgeSec: 7200,
        },
      ],
      edges: [],
    };
    const findings = await analyzer(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
  });

  it('does not flag fresh queue', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          encrypted: true,
          oldestMessageAgeSec: 30,
        },
      ],
      edges: [],
    };
    expect(await analyzer(graph)).toHaveLength(0);
  });
});

describe('CloudFrontInsecureViewerProtocolAnalyzer', () => {
  const analyzer = CloudFrontInsecureViewerProtocolAnalyzer;

  const distribution = (viewerProtocolPolicy: string, enabled = true): SystemGraph => ({
    nodes: [
      {
        id: 'distribution:aws:E123',
        type: 'distribution',
        name: 'public front door',
        provider: 'aws',
        distributionId: 'E123',
        domainName: 'd123.cloudfront.net',
        enabled,
        behaviors: [
          {
            pathPattern: '/api/*',
            targetOriginId: 'orders-api',
            viewerProtocolPolicy,
            isDefault: false,
          },
        ],
      },
    ],
    edges: [],
  });

  it('flags a behavior that allows plain HTTP', async () => {
    const findings = await analyzer(distribution('allow-all'));
    expect(findings).toHaveLength(1);
    expect(findings[0].issue).toContain('/api/*');
    expect(findings[0].metadata?.distributionId).toBe('E123');
  });

  it('passes a behavior that redirects to HTTPS', async () => {
    expect(await analyzer(distribution('redirect-to-https'))).toHaveLength(0);
  });

  it('ignores a disabled distribution', async () => {
    expect(await analyzer(distribution('allow-all', false))).toHaveLength(0);
  });
});

describe('MissingPartialBatchResponseAnalyzer', () => {
  const lambda = (trigger: Record<string, unknown>): SystemGraph => ({
    nodes: [
      {
        id: 'lambda:aws:processOrders',
        type: 'lambda',
        name: 'processOrders',
        triggers: [
          {
            type: 'sqs',
            sourceArn: 'arn:aws:sqs:::orders',
            sourceName: 'orders',
            eventShape: 'e',
            ...trigger,
          },
        ],
      },
    ],
    edges: [],
  });

  it('flags a batch trigger that does not report partial failures', async () => {
    const findings = await MissingPartialBatchResponseAnalyzer(
      lambda({ batchSize: 10, reportsBatchItemFailures: false }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].description).toContain('batch size of 10');
  });

  it('stays quiet when partial batch response is configured', async () => {
    const findings = await MissingPartialBatchResponseAnalyzer(
      lambda({ batchSize: 10, reportsBatchItemFailures: true }),
    );
    expect(findings).toHaveLength(0);
  });

  it('stays quiet for a batch of one, which cannot partially fail', async () => {
    const findings = await MissingPartialBatchResponseAnalyzer(
      lambda({ batchSize: 1, reportsBatchItemFailures: false }),
    );
    expect(findings).toHaveLength(0);
  });

  it('claims nothing when the mapping was never read', async () => {
    const findings = await MissingPartialBatchResponseAnalyzer(lambda({ batchSize: 10 }));
    expect(findings).toHaveLength(0);
  });
});

describe('ShortRetentionNoDLQAnalyzer', () => {
  const queue = (extra: Record<string, unknown>): SystemGraph => ({
    nodes: [
      {
        id: 'queue:aws:orders',
        type: 'queue',
        name: 'orders',
        provider: 'aws',
        hasDLQ: false,
        encrypted: true,
        ...extra,
      },
    ],
    edges: [],
  });

  it('flags default retention on a queue with no DLQ', async () => {
    const findings = await ShortRetentionNoDLQAnalyzer(queue({ retentionDays: 4 }));
    expect(findings).toHaveLength(1);
  });

  it('stays quiet when retention is long', async () => {
    const findings = await ShortRetentionNoDLQAnalyzer(queue({ retentionDays: 14 }));
    expect(findings).toHaveLength(0);
  });

  it('stays quiet when a DLQ exists', async () => {
    const findings = await ShortRetentionNoDLQAnalyzer(queue({ retentionDays: 4, hasDLQ: true }));
    expect(findings).toHaveLength(0);
  });

  it('does not flag a queue that is itself a DLQ target', async () => {
    const findings = await ShortRetentionNoDLQAnalyzer({
      nodes: [
        {
          id: 'queue:aws:orders',
          type: 'queue',
          name: 'orders',
          provider: 'aws',
          hasDLQ: true,
          dlqArn: 'arn:aws:sqs:us-east-1:1:orders-dlq',
          encrypted: true,
          retentionDays: 4,
        },
        {
          id: 'queue:aws:orders-dlq',
          type: 'queue',
          name: 'orders-dlq',
          provider: 'aws',
          hasDLQ: false,
          encrypted: true,
          retentionDays: 4,
        },
      ],
      edges: [],
    });
    expect(findings).toHaveLength(0);
  });

  it('claims nothing when retention was never read', async () => {
    const findings = await ShortRetentionNoDLQAnalyzer(queue({}));
    expect(findings).toHaveLength(0);
  });
});

describe('LambdaUnboundedConcurrencyAnalyzer', () => {
  const fn = (extra: Record<string, unknown>): SystemGraph => ({
    nodes: [
      {
        id: 'lambda:aws:processOrders',
        type: 'lambda',
        name: 'processOrders',
        triggers: [
          { type: 'sqs', sourceArn: 'arn:aws:sqs:::orders', sourceName: 'orders', eventShape: 'e' },
        ],
        ...extra,
      },
    ],
    edges: [],
  });

  it('flags a polled function with no reservation', async () => {
    const findings = await LambdaUnboundedConcurrencyAnalyzer(fn({ reservedConcurrency: null }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('verify');
  });

  it('stays quiet when a reservation is set', async () => {
    const findings = await LambdaUnboundedConcurrencyAnalyzer(fn({ reservedConcurrency: 10 }));
    expect(findings).toHaveLength(0);
  });

  it('claims nothing when concurrency was never read', async () => {
    const findings = await LambdaUnboundedConcurrencyAnalyzer(fn({}));
    expect(findings).toHaveLength(0);
  });

  it('ignores a function with no poll-based trigger', async () => {
    const findings = await LambdaUnboundedConcurrencyAnalyzer({
      nodes: [
        {
          id: 'lambda:aws:api',
          type: 'lambda',
          name: 'api',
          reservedConcurrency: null,
          triggers: [{ type: 's3', sourceArn: 'arn:aws:s3:::b', sourceName: 'b', eventShape: 'e' }],
        },
      ],
      edges: [],
    });
    expect(findings).toHaveLength(0);
  });
});
