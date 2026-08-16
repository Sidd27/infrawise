import * as fs from 'fs';
import * as path from 'path';
import type { CacheEntry } from '../types.js';

const CACHE_VERSION = '1.0.0';
let cacheDir = path.join(process.cwd(), '.infrawise', 'cache');

export function setCacheDir(dir: string): void {
  cacheDir = path.join(dir, '.infrawise', 'cache');
}

export function getCacheDir(): string {
  return cacheDir;
}

function ensureCacheDir(): void {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

export function writeCache<T>(key: string, data: T): void {
  ensureCacheDir();
  const entry: CacheEntry<T> = {
    timestamp: Date.now(),
    data,
    version: CACHE_VERSION,
  };
  // Write-then-rename: rename is atomic within a directory, so a reader never
  // observes a half-written entry. The MCP server watches this directory and
  // reloads on change — a torn read there fails the JSON parse, is swallowed as
  // "no cache", and leaves the server serving the previous analysis with no
  // error anywhere.
  const filePath = path.join(cacheDir, `${key}.json`);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(entry), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function readEntry<T>(key: string): CacheEntry<T> | null {
  const filePath = path.join(cacheDir, `${key}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CacheEntry<T>;
  } catch {
    return null;
  }
}

// One TTL for every entry. This was a per-call parameter with a 1h default, and
// every caller that took the default was a bug: the graph expired at 24h while
// metadata, provenance and CI findings expired at 1h, so a long session served a
// graph whose companion entries had silently gone null. The entries describe one
// analysis and expire as one.
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function readCache<T>(key: string): T | null {
  const entry = readEntry<T>(key);
  if (!entry) return null;
  if (entry.version !== CACHE_VERSION) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
  return entry.data;
}

// Returns when the entry was written (ms epoch), ignoring TTL — used to surface
// analysis freshness. null if the entry is missing or unreadable.
export function readCacheTimestamp(key: string): number | null {
  return readEntry(key)?.timestamp ?? null;
}
