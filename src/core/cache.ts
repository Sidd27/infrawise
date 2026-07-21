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

export function readCache<T>(key: string, maxAgeMs = 3600000): T | null {
  const filePath = path.join(cacheDir, `${key}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry: CacheEntry<T> = JSON.parse(raw);

    if (entry.version !== CACHE_VERSION) return null;
    if (Date.now() - entry.timestamp > maxAgeMs) return null;

    return entry.data;
  } catch {
    return null;
  }
}

// Returns when the entry was written (ms epoch), ignoring TTL — used to surface
// analysis freshness. null if the entry is missing or unreadable.
export function readCacheTimestamp(key: string): number | null {
  const filePath = path.join(cacheDir, `${key}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const entry: CacheEntry<unknown> = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return typeof entry.timestamp === 'number' ? entry.timestamp : null;
  } catch {
    return null;
  }
}

export function clearCache(key?: string): void {
  if (key) {
    const filePath = path.join(cacheDir, `${key}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } else {
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true });
  }
}
