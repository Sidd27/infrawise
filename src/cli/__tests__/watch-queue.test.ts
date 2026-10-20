import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  event: undefined as undefined | ((event: string, filename: string) => void),
  refresh: vi.fn(),
  analyze: vi.fn(),
}));

vi.mock('fs', async (original) => ({
  ...(await original<typeof import('fs')>()),
  watch: vi.fn((_path, _options, callback) => {
    mocks.event = callback;
  }),
}));
vi.mock('../commands/analyze.js', () => ({
  runCodeRefresh: mocks.refresh,
  runAnalyze: mocks.analyze,
}));

import { watchCode } from '../mcp-boot.js';

describe('watch refresh queue', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('refreshes cloud metadata in the background only when configured', async () => {
    vi.useFakeTimers();
    mocks.analyze.mockResolvedValue(undefined);
    watchCode(
      '/repo',
      { project: 'test', freshness: { refreshIntervalMinutes: 1 } },
      '/repo/infrawise.yaml',
      { onDone: vi.fn() },
    );
    expect(mocks.analyze).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    await vi.dynamicImportSettled();
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(mocks.analyze).toHaveBeenCalledWith({
      repo: '/repo',
      config: '/repo/infrawise.yaml',
      silent: true,
    });
    mocks.event?.('change', 'infrawise.yaml');
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it('batches saves and processes changes made during a running refresh', async () => {
    vi.useFakeTimers();
    let complete: (value: unknown) => void = () => {};
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const result = { graph: { nodes: [], edges: [] }, findings: [] };
    mocks.refresh.mockResolvedValue(result);
    const onDone = vi.fn();
    watchCode('/repo', { project: 'test' }, '/repo/infrawise.yaml', { onDone });
    mocks.event?.('change', 'first.ts');
    mocks.event?.('change', 'second.py');
    await vi.advanceTimersByTimeAsync(2000);
    await vi.dynamicImportSettled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    mocks.event?.('change', 'third.ts');
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    complete(result);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
