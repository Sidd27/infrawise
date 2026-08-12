import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../s3.js';

// S3 sub-resource calls are virtual-hosted, so every bucket is its own hostname
// with its own TLS handshake. Walking buckets serially pays that setup one at a
// time, which is why S3 alone took minutes where other services took seconds.
describe('mapWithConcurrency', () => {
  it('keeps results in input order regardless of completion order', async () => {
    const out = await mapWithConcurrency([50, 10, 30, 0, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([50, 10, 30, 0, 20]);
  });

  it('never exceeds the limit, and does run concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return i * 2;
      },
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(out).toHaveLength(20);
    expect(out[19]).toBe(38);
  });

  it('handles fewer items than the limit, and an empty list', async () => {
    expect(await mapWithConcurrency([1, 2], 8, async (n) => n + 1)).toEqual([2, 3]);
    expect(await mapWithConcurrency([], 8, async (n: number) => n)).toEqual([]);
  });

  it('rejects if a worker throws, rather than resolving a hole', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
