import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  event: undefined as undefined | ((event: string, filename: string) => void),
  refresh: vi.fn(),
}));

vi.mock('fs', async (original) => ({
  ...(await original<typeof import('fs')>()),
  watch: vi.fn((_path, _options, callback) => {
    mocks.event = callback;
  }),
}));
vi.mock('../commands/analyze.js', () => ({ runCodeRefresh: mocks.refresh }));

import { watchCode } from '../mcp-boot.js';

describe('watch refresh queue', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
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
