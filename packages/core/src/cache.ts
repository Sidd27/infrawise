import * as fs from 'fs';
import * as path from 'path';
import type { CacheEntry } from '@infrawise/shared';

const CACHE_VERSION = '1.0.0';
const CACHE_DIR = path.join(process.cwd(), '.infrawise', 'cache');

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function writeCache<T>(key: string, data: T): void {
  ensureCacheDir();
  const entry: CacheEntry<T> = {
    timestamp: Date.now(),
    data,
    version: CACHE_VERSION,
  };
  const filePath = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
}

export function readCache<T>(key: string, maxAgeMs = 3600000): T | null {
  const filePath = path.join(CACHE_DIR, `${key}.json`);
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

export function clearCache(key?: string): void {
  if (key) {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } else {
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      }
    }
  }
}
