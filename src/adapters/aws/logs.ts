import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { fromIni } from '@aws-sdk/credential-providers';
import type { LogGroupSummary } from '../../types.js';
import { logger } from '../../core/index.js';

interface LogsConfig {
  region?: string;
  profile?: string;
  logGroupPrefixes?: string[];
  windowHours?: number;
}

function clientConfig(cfg: LogsConfig) {
  const region = cfg.region ?? 'us-east-1';
  const base: Record<string, unknown> = { region };
  if (cfg.profile) base.credentials = fromIni({ profile: cfg.profile });
  return base;
}

export async function extractLogsMetadata(cfg: LogsConfig = {}): Promise<LogGroupSummary[]> {
  const client = new CloudWatchLogsClient(clientConfig(cfg));
  const summaries: LogGroupSummary[] = [];

  // Discover log groups
  const logGroups: Array<{ name: string; retentionDays?: number }> = [];
  const prefixes = cfg.logGroupPrefixes?.length
    ? cfg.logGroupPrefixes
    : [undefined as string | undefined];
  for (const prefix of prefixes) {
    let nextToken: string | undefined;
    do {
      const res = await client.send(
        new DescribeLogGroupsCommand({
          nextToken,
          limit: 50,
          ...(prefix ? { logGroupNamePrefix: prefix } : {}),
        }),
      );
      for (const lg of res.logGroups ?? []) {
        logGroups.push({ name: lg.logGroupName ?? '', retentionDays: lg.retentionInDays });
      }
      nextToken = res.nextToken;
    } while (nextToken);
  }

  const seen = new Set<string>();
  for (const lg of logGroups) {
    if (seen.has(lg.name)) continue;
    seen.add(lg.name);
    summaries.push({
      logGroupName: lg.name,
      retentionDays: lg.retentionDays,
      errorCount: null,
      warnCount: null,
      topErrorPatterns: [],
    });
  }

  logger.debug(`CloudWatch Logs: read metadata for ${summaries.length} log group(s)`);
  return summaries;
}

export async function validateLogsAccess(cfg: LogsConfig = {}): Promise<void> {
  await new CloudWatchLogsClient(clientConfig(cfg)).send(
    new DescribeLogGroupsCommand({ limit: 1 }),
  );
}

export type { LogGroupSummary };
