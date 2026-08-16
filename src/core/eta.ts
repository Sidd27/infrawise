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

export function recordRunTiming(totalMs: number, sources: Record<string, number>): void {
  const timings = readTimings();
  timings.push({ totalMs, sources });
  fs.mkdirSync(getCacheDir(), { recursive: true });
  const trimmed = timings.slice(-TIMINGS_LIMIT);
  const filePath = timingsPath();
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(trimmed), 'utf-8');
  fs.renameSync(tmpPath, filePath);
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
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
