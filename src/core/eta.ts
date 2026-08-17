import * as fs from 'fs';
import * as path from 'path';
import { getCacheDir } from './cache.js';

// Per-run extraction timings, kept so the next run can predict how long it will
// take. Prediction is an exponential moving average of total wall-clock, because
// extractors run in parallel — the sum of per-source times is not the runtime.

const TIMINGS_LIMIT = 10;

export interface RunTiming {
  totalMs: number;
  sources: Record<string, number>;
}

function timingsPath(): string {
  return path.join(getCacheDir(), 'timings.json');
}

export function readTimings(): RunTiming[] {
  const filePath = timingsPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return Array.isArray(parsed) ? (parsed as RunTiming[]) : [];
  } catch {
    return [];
  }
}

// A lost timing sample costs a slightly worse ETA next run. Letting it abort an
// otherwise successful analysis costs the analysis, so a read-only or full cache
// dir is swallowed here the same way readTimings swallows its own read errors.
export function recordRunTiming(totalMs: number, sources: Record<string, number>): void {
  try {
    const timings = readTimings();
    timings.push({ totalMs, sources });
    fs.mkdirSync(getCacheDir(), { recursive: true });
    const trimmed = timings.slice(-TIMINGS_LIMIT);
    const filePath = timingsPath();
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(trimmed), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    // ignored
  }
}

// EMA of total wall-clock across past runs. null when there is no history yet.
export function estimateExtractionMs(): { totalMs: number; runs: number } | null {
  const totals = readTimings().map((t) => t.totalMs);
  if (totals.length === 0) return null;
  let ema = totals[0];
  for (const t of totals.slice(1)) ema = 0.5 * t + 0.5 * ema;
  return { totalMs: Math.round(ema), runs: totals.length };
}

// Top-n slowest sources of a run, longest first, for the completion line.
export function slowestSources(sources: Record<string, number>, n = 3): [string, number][] {
  return Object.entries(sources)
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  // Round once, then split. Rounding the seconds remainder independently of the
  // floored minutes yields "1m 60s" for 119700 and "60s" for 59960.
  const tenths = Math.round(ms / 100) / 10;
  if (tenths < 60) return `${tenths}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
