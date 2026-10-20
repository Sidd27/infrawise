import { afterEach, expect, it, vi } from 'vitest';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { extractLogsMetadata } from '../logs.js';

afterEach(() => vi.restoreAllMocks());
it('reads paginated group metadata without requesting message bodies', async () => {
  const send = vi
    .spyOn(CloudWatchLogsClient.prototype, 'send')
    .mockImplementation(async (command) => {
      expect(command).toBeInstanceOf(DescribeLogGroupsCommand);
      return (command as DescribeLogGroupsCommand).input.nextToken
        ? { logGroups: [{ logGroupName: 'second', retentionInDays: 14 }] }
        : { logGroups: [{ logGroupName: 'first' }], nextToken: 'page2' };
    });
  const groups = await extractLogsMetadata();
  expect(send).toHaveBeenCalledTimes(2);
  expect(groups).toEqual([
    {
      logGroupName: 'first',
      retentionDays: undefined,
      errorCount: null,
      warnCount: null,
      topErrorPatterns: [],
    },
    {
      logGroupName: 'second',
      retentionDays: 14,
      errorCount: null,
      warnCount: null,
      topErrorPatterns: [],
    },
  ]);
});
