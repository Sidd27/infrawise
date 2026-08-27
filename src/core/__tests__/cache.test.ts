import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  writeCache,
  readCache,
  readCacheTimestamp,
  touchCache,
  setCacheDir,
  getCacheDir,
  CACHE_TTL_MS,
} from '../cache.js';

// Every test gets its own cache root. Sharing one dir across the file made the
// suite order-dependent: a test that repointed setCacheDir left every later test
// reading a directory nothing was writing to.
let root: string;
let CACHE_DIR: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-cache-'));
  setCacheDir(root);
  CACHE_DIR = path.join(root, '.infrawise', 'cache');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
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

describe('touchCache', () => {
  // The bug this exists for: a serve/stdio session's file watcher rewrites
  // graph/findings/operations on every save and reads no AWS, so meta and
  // provenance aged out underneath a graph that kept being re-stamped. The
  // server then rebuilt the graph with no cloud metadata and lost analyzedAt,
  // which pins dataHealth.suggestRefresh to true for the rest of the session.
  const read = (key: string) =>
    JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf8')) as {
      timestamp: number;
      data: unknown;
      version: string;
    };

  const backdate = (key: string, ms: number) => {
    const file = path.join(CACHE_DIR, `${key}.json`);
    const entry = read(key);
    entry.timestamp -= ms;
    fs.writeFileSync(file, JSON.stringify(entry));
  };

  it('brings an entry past the TTL back inside it', () => {
    writeCache('provenance', { analyzedAt: 1, sources: [{ service: 'sqs' }] });
    backdate('provenance', CACHE_TTL_MS + 60_000);
    expect(readCache('provenance')).toBeNull();

    touchCache('provenance');

    expect(readCache('provenance')).toEqual({ analyzedAt: 1, sources: [{ service: 'sqs' }] });
  });

  it('moves the entry clock forward without touching the data', () => {
    const data = { dynamoMeta: [{ tableName: 'orders', indexes: [] }], servicesMeta: {} };
    writeCache('meta', data);
    const before = read('meta');
    backdate('meta', 2 * CACHE_TTL_MS);

    touchCache('meta');

    const after = read('meta');
    expect(after.data).toEqual(before.data);
    expect(after.version).toBe(before.version);
    expect(after.timestamp).toBeGreaterThan(before.timestamp - 1);
    expect(Date.now() - after.timestamp).toBeLessThan(5_000);
  });

  it('is a no-op for a key that was never written', () => {
    expect(() => touchCache('never-written')).not.toThrow();
    expect(fs.existsSync(path.join(CACHE_DIR, 'never-written.json'))).toBe(false);
    expect(readCacheTimestamp('never-written')).toBeNull();
  });

  it('is a no-op on a corrupted entry rather than rewriting it', () => {
    const file = path.join(CACHE_DIR, 'corrupted.json');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, 'not valid json', 'utf-8');

    touchCache('corrupted');

    expect(fs.readFileSync(file, 'utf8')).toBe('not valid json');
    expect(readCache('corrupted')).toBeNull();
  });

  // Re-stamping a stale-schema entry would resurrect it under the current
  // version — data the readers cannot parse, now indistinguishable from fresh.
  it('refuses to resurrect an entry written by a different cache version', () => {
    const file = path.join(CACHE_DIR, 'old-version.json');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const stale = {
      timestamp: Date.now() - 5 * CACHE_TTL_MS,
      data: { shape: 'old' },
      version: '0.0.0',
    };
    fs.writeFileSync(file, JSON.stringify(stale), 'utf-8');

    touchCache('old-version');

    expect(read('old-version')).toEqual(stale);
    expect(readCache('old-version')).toBeNull();
  });

  it('is idempotent and leaves no temp file behind', () => {
    writeCache('graph', { nodes: [{ id: 'n1' }] });
    for (let i = 0; i < 3; i++) touchCache('graph');

    expect(readCache<{ nodes: unknown[] }>('graph')?.nodes).toEqual([{ id: 'n1' }]);
    expect(fs.readdirSync(CACHE_DIR)).toEqual(['graph.json']);
  });

  // Every sibling on one clock is the whole point: touching must keep an entry
  // alive across repeated refreshes for as long as the graph is being rewritten.
  it('keeps siblings alive across successive refresh cycles', () => {
    writeCache('meta', { dynamoMeta: [] });
    writeCache('provenance', { analyzedAt: 42 });

    for (let cycle = 0; cycle < 3; cycle++) {
      backdate('meta', CACHE_TTL_MS - 1000);
      backdate('provenance', CACHE_TTL_MS - 1000);
      touchCache('meta');
      touchCache('provenance');
      writeCache('graph', { nodes: [] });
    }

    expect(readCache('meta')).toEqual({ dynamoMeta: [] });
    expect(readCache<{ analyzedAt: number }>('provenance')?.analyzedAt).toBe(42);
  });
});

describe('getCacheDir', () => {
  it('reports the directory setCacheDir resolved', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-dir-'));
    setCacheDir(dir);
    expect(getCacheDir()).toBe(path.join(dir, '.infrawise', 'cache'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
