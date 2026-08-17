import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setCacheDir } from '../index.js';
import {
  recordRunTiming,
  readTimings,
  estimateExtractionMs,
  slowestSources,
  formatDuration,
} from '../eta.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-eta-'));
  setCacheDir(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('recordRunTiming / readTimings', () => {
  it('round-trips a run and keeps only the last 10', () => {
    for (let i = 0; i < 12; i++) recordRunTiming(1000 + i, { sqs: 500 });
    const timings = readTimings();
    expect(timings).toHaveLength(10);
    expect(timings[9].totalMs).toBe(1011);
  });
});

describe('estimateExtractionMs', () => {
  it('returns null with no history', () => {
    expect(estimateExtractionMs()).toBeNull();
  });

  it('returns the single run as the estimate', () => {
    recordRunTiming(10000, {});
    expect(estimateExtractionMs()).toEqual({ totalMs: 10000, runs: 1 });
  });

  it('averages multiple runs with recency bias (EMA)', () => {
    recordRunTiming(10000, {});
    recordRunTiming(20000, {});
    // ema = 0.5 * 20000 + 0.5 * 10000
    expect(estimateExtractionMs()).toEqual({ totalMs: 15000, runs: 2 });
  });
});

describe('slowestSources', () => {
  it('sorts descending, drops zero-duration entries, honors the limit', () => {
    expect(slowestSources({ sqs: 500, dynamodb: 3000, lambda: 0, rds: 1200 }, 2)).toEqual([
      ['dynamodb', 3000],
      ['rds', 1200],
    ]);
  });
});

describe('formatDuration', () => {
  it('formats ms, seconds, and minutes', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(70000)).toBe('1m 10s');
  });

  it('never carries a 60 into the seconds slot', () => {
    expect(formatDuration(59960)).toBe('1m 0s');
    expect(formatDuration(119700)).toBe('2m 0s');
    expect(formatDuration(3599000)).toBe('59m 59s');
  });
});

describe('recordRunTiming', () => {
  it('swallows IO errors rather than aborting the analysis', () => {
    setCacheDir('/proc/nonexistent-infrawise');
    expect(() => recordRunTiming(1000, { sqs: 500 })).not.toThrow();
  });
});
