import { afterEach, expect, it, vi } from 'vitest';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { extractRuntimeSignals } from '../metrics.js';
import { PartialExtractionError } from '../../../core/index.js';

afterEach(() => vi.restoreAllMocks());
it('reports failed or incomplete metric reads instead of presenting them as zero activity', async () => {
  const send = vi
    .spyOn(CloudWatchClient.prototype, 'send')
    .mockRejectedValueOnce(new Error('AccessDenied'));
  await expect(extractRuntimeSignals({}, ['handler'], [])).rejects.toBeInstanceOf(
    PartialExtractionError,
  );
  send.mockResolvedValueOnce({
    MetricDataResults: [{ Id: 'lt0', StatusCode: 'PartialData', Values: [] }],
  } as never);
  await expect(extractRuntimeSignals({}, ['handler'], [])).rejects.toBeInstanceOf(
    PartialExtractionError,
  );
});
