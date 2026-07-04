import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import type { MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { clientConfig, type AWSConfig } from './services.js';
import { logger } from '../../core/index.js';

export interface LambdaSignals {
  throttles: number;
  errors: number;
}

export interface QueueSignals {
  oldestMessageAgeSec: number;
}

export async function extractRuntimeSignals(
  cfg: AWSConfig,
  lambdaNames: string[],
  queueNames: string[],
  windowHours = 24,
): Promise<{ lambdas: Map<string, LambdaSignals>; queues: Map<string, QueueSignals> }> {
  const lambdas = new Map<string, LambdaSignals>();
  const queues = new Map<string, QueueSignals>();
  if (lambdaNames.length === 0 && queueNames.length === 0) return { lambdas, queues };

  const client = new CloudWatchClient(clientConfig(cfg));
  const end = new Date();
  const start = new Date(end.getTime() - windowHours * 3600 * 1000);
  const period = windowHours * 3600;

  // Metric names live in Dimensions; query Ids are positional because function/queue
  // names may contain characters GetMetricData Ids do not allow.
  const queries: MetricDataQuery[] = [];
  lambdaNames.forEach((name, i) => {
    queries.push(
      {
        Id: `lt${i}`,
        MetricStat: {
          Metric: {
            Namespace: 'AWS/Lambda',
            MetricName: 'Throttles',
            Dimensions: [{ Name: 'FunctionName', Value: name }],
          },
          Period: period,
          Stat: 'Sum',
        },
      },
      {
        Id: `le${i}`,
        MetricStat: {
          Metric: {
            Namespace: 'AWS/Lambda',
            MetricName: 'Errors',
            Dimensions: [{ Name: 'FunctionName', Value: name }],
          },
          Period: period,
          Stat: 'Sum',
        },
      },
    );
  });
  queueNames.forEach((name, i) => {
    queries.push({
      Id: `qa${i}`,
      MetricStat: {
        Metric: {
          Namespace: 'AWS/SQS',
          MetricName: 'ApproximateAgeOfOldestMessage',
          Dimensions: [{ Name: 'QueueName', Value: name }],
        },
        Period: period,
        Stat: 'Maximum',
      },
    });
  });

  try {
    for (let i = 0; i < queries.length; i += 500) {
      const chunk = queries.slice(i, i + 500);
      let nextToken: string | undefined;
      do {
        const res = await client.send(
          new GetMetricDataCommand({
            StartTime: start,
            EndTime: end,
            MetricDataQueries: chunk,
            NextToken: nextToken,
          }),
        );
        for (const r of res.MetricDataResults ?? []) {
          const id = r.Id ?? '';
          const value = r.Values?.[0] ?? 0;
          const idx = parseInt(id.slice(2), 10);
          if (Number.isNaN(idx)) continue;
          if (id.startsWith('lt')) {
            const e = lambdas.get(lambdaNames[idx]) ?? { throttles: 0, errors: 0 };
            e.throttles = value;
            lambdas.set(lambdaNames[idx], e);
          } else if (id.startsWith('le')) {
            const e = lambdas.get(lambdaNames[idx]) ?? { throttles: 0, errors: 0 };
            e.errors = value;
            lambdas.set(lambdaNames[idx], e);
          } else if (id.startsWith('qa')) {
            queues.set(queueNames[idx], { oldestMessageAgeSec: value });
          }
        }
        nextToken = res.NextToken;
      } while (nextToken);
    }
  } catch (err) {
    logger.warn(
      `Runtime signals fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { lambdas, queues };
}
