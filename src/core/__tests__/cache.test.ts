import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { writeCache, readCache, setCacheDir, CACHE_TTL_MS } from '../cache.js';

const CACHE_DIR = path.join(process.cwd(), '.infrawise', 'cache');

afterEach(() => {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
});

describe('writeCache / readCache', () => {
  it('writes and reads back a value', () => {
    writeCache('test-key', { foo: 'bar' });
    const result = readCache<{ foo: string }>('test-key');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('returns null for a key that was never written', () => {
    expect(readCache('nonexistent')).toBeNull();
  });

  it('returns null once an entry passes the 24h TTL', () => {
    writeCache('expiring-key', { data: 1 });
    const file = path.join(CACHE_DIR, 'expiring-key.json');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as { timestamp: number };
    entry.timestamp -= CACHE_TTL_MS + 1000;
    fs.writeFileSync(file, JSON.stringify(entry));
    expect(readCache('expiring-key')).toBeNull();
  });

  it('returns data inside the TTL', () => {
    writeCache('fresh-key', { data: 42 });
    expect(readCache<{ data: number }>('fresh-key')?.data).toBe(42);
  });

  it('returns null when cache file is corrupted', () => {
    const filePath = path.join(CACHE_DIR, 'corrupted.json');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(filePath, 'not valid json', 'utf-8');
    expect(readCache('corrupted')).toBeNull();
  });

  it('returns null when version does not match', () => {
    const filePath = path.join(CACHE_DIR, 'old-version.json');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ timestamp: Date.now(), data: {}, version: '0.0.0' }),
      'utf-8',
    );
    expect(readCache('old-version')).toBeNull();
  });

  it('handles various data types', () => {
    writeCache('array-key', [1, 2, 3]);
    expect(readCache<number[]>('array-key')).toEqual([1, 2, 3]);

    writeCache('string-key', 'hello');
    expect(readCache<string>('string-key')).toBe('hello');

    writeCache('number-key', 99);
    expect(readCache<number>('number-key')).toBe(99);
  });
});

describe('atomic writes', () => {
  // The real hazard is cross-process: `infrawise analyze` writes while the MCP
  // server's cache watcher reads. Reproducing a torn read needs two processes
  // racing, which is not worth the flake here — the guarantee comes from rename
  // being atomic within a directory. What is checked: the entry survives a
  // rewrite intact and no temp file is left behind to be mistaken for a key.
  it('leaves no temp file and keeps the entry readable across rewrites', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-atomic-'));
    setCacheDir(dir);
    const big = { nodes: Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}` })) };

    writeCache('graph', { nodes: [{ id: 'old' }] });
    for (let i = 0; i < 5; i++) writeCache('graph', big);

    expect(readCache<typeof big>('graph')?.nodes).toHaveLength(5000);
    expect(fs.readdirSync(path.join(dir, '.infrawise', 'cache'))).toEqual(['graph.json']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
