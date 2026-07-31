import * as fs from 'fs';
import * as path from 'path';
import type { CacheEntry } from '../types.js';

const CACHE_VERSION = '1.0.0';
let cacheDir = path.join(process.cwd(), '.infrawise', 'cache');

export function setCacheDir(dir: string): void {
  cacheDir = path.join(dir, '.infrawise', 'cache');
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
  const filePath = path.join(cacheDir, `${key}.json`);
  fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
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

export function readCache<T>(key: string, maxAgeMs = 3600000): T | null {
  const entry = readEntry<T>(key);
  if (!entry) return null;
  if (entry.version !== CACHE_VERSION) return null;
  if (Date.now() - entry.timestamp > maxAgeMs) return null;
  return entry.data;
}

// Returns when the entry was written (ms epoch), ignoring TTL — used to surface
// analysis freshness. null if the entry is missing or unreadable.
export function readCacheTimestamp(key: string): number | null {
  return readEntry(key)?.timestamp ?? null;
}
