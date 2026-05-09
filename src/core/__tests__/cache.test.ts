import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { writeCache, readCache, clearCache } from '../cache';

const CACHE_DIR = path.join(process.cwd(), '.infrawise', 'cache');

afterEach(() => {
  clearCache();
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

  it('returns null when cache entry has expired', () => {
    writeCache('expiring-key', { data: 1 });
    const result = readCache('expiring-key', -1);
    expect(result).toBeNull();
  });

  it('returns data when within maxAgeMs', () => {
    writeCache('fresh-key', { data: 42 });
    const result = readCache<{ data: number }>('fresh-key', 60000);
    expect(result?.data).toBe(42);
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
    fs.writeFileSync(filePath, JSON.stringify({ timestamp: Date.now(), data: {}, version: '0.0.0' }), 'utf-8');
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

describe('clearCache', () => {
  it('clears a specific key', () => {
    writeCache('key-a', { a: 1 });
    writeCache('key-b', { b: 2 });
    clearCache('key-a');
    expect(readCache('key-a')).toBeNull();
    expect(readCache<{ b: number }>('key-b')).toEqual({ b: 2 });
  });

  it('clears all keys when called without argument', () => {
    writeCache('key-a', 1);
    writeCache('key-b', 2);
    clearCache();
    expect(readCache('key-a')).toBeNull();
    expect(readCache('key-b')).toBeNull();
  });

  it('does not throw when clearing a key that does not exist', () => {
    expect(() => clearCache('does-not-exist')).not.toThrow();
  });

  it('does not throw when clearing all keys on an empty cache dir', () => {
    clearCache();
    expect(() => clearCache()).not.toThrow();
  });
});
