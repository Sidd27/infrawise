import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { fromIni } from '@aws-sdk/credential-providers';
import type { LogGroupSummary } from '../types';
import { logger } from '../core';

// Hard caps to prevent context bloat
const MAX_LOG_GROUPS = 50;
const MAX_EVENTS_PER_GROUP = 50;

interface LogsConfig {
  region?: string;
  profile?: string;
  logGroupPrefixes?: string[];
  windowHours?: number;
}

function clientConfig(cfg: LogsConfig) {
  const region = cfg.region ?? 'us-east-1';
  return cfg.profile
    ? { region, credentials: fromIni({ profile: cfg.profile }) }
    : { region };
}

// Strip UUIDs, timestamps, numbers → group similar messages by pattern
function toPattern(message: string): string {
  return message
    .slice(0, 200)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<TIMESTAMP>')
    .replace(/\b\d{5,}\b/g, '<NUM>')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<IP>')
    .replace(/Bearer\s+\S+/gi, 'Bearer <TOKEN>')
    .trim();
}

function topPatterns(
  messages: string[],
  limit = 5,
): Array<{ pattern: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const msg of messages) {
    const p = toPattern(msg);
    counts[p] = (counts[p] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([pattern, count]) => ({ pattern, count }));
}

export async function extractLogsSummary(cfg: LogsConfig = {}): Promise<LogGroupSummary[]> {
  const client = new CloudWatchLogsClient(clientConfig(cfg));
  const windowMs = (cfg.windowHours ?? 24) * 60 * 60 * 1000;
  const startTime = Date.now() - windowMs;
  const summaries: LogGroupSummary[] = [];

  // Discover log groups
  const logGroups: Array<{ name: string; retentionDays?: number }> = [];
  try {
    const prefixes = cfg.logGroupPrefixes?.length ? cfg.logGroupPrefixes : [undefined as string | undefined];
    for (const prefix of prefixes) {
      let nextToken: string | undefined;
      do {
        const res = await client.send(new DescribeLogGroupsCommand({
          nextToken,
          limit: Math.min(50, MAX_LOG_GROUPS - logGroups.length),
          ...(prefix ? { logGroupNamePrefix: prefix } : {}),
        }));
        for (const lg of res.logGroups ?? []) {
          logGroups.push({ name: lg.logGroupName ?? '', retentionDays: lg.retentionInDays });
        }
        nextToken = res.nextToken;
        if (logGroups.length >= MAX_LOG_GROUPS) break;
      } while (nextToken);
      if (logGroups.length >= MAX_LOG_GROUPS) break;
    }
  } catch (err) {
    logger.warn(`CloudWatch Logs discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    return summaries;
  }

  // Sample errors from each group — patterns only, never raw messages for unrelated groups
  for (const lg of logGroups) {
    const errorMessages: string[] = [];
    const warnMessages: string[] = [];
    let lastErrorTime: string | undefined;

    for (const filterPattern of ['ERROR', 'Exception', 'WARN']) {
      if (errorMessages.length + warnMessages.length >= MAX_EVENTS_PER_GROUP) break;
      try {
        const res = await client.send(new FilterLogEventsCommand({
          logGroupName: lg.name,
          filterPattern,
          startTime,
          limit: 25,
        }));
        for (const event of res.events ?? []) {
          const msg = event.message ?? '';
          if (filterPattern === 'WARN') {
            warnMessages.push(msg);
          } else {
            errorMessages.push(msg);
            if (event.timestamp) {
              const ts = new Date(event.timestamp).toISOString();
              if (!lastErrorTime || ts > lastErrorTime) lastErrorTime = ts;
            }
          }
        }
      } catch {
        // Filter pattern may not match; continue
      }
    }

    summaries.push({
      logGroupName: lg.name,
      retentionDays: lg.retentionDays,
      errorCount: errorMessages.length,
      warnCount: warnMessages.length,
      topErrorPatterns: topPatterns(errorMessages),
      lastErrorTime,
    });
  }

  logger.debug(`CloudWatch Logs: sampled ${summaries.length} log group(s)`);
  return summaries;
}

export async function validateLogsAccess(cfg: LogsConfig = {}): Promise<void> {
  await new CloudWatchLogsClient(clientConfig(cfg)).send(
    new DescribeLogGroupsCommand({ limit: 1 }),
  );
}

export type { LogGroupSummary };
