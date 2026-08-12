import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setCacheDir, writeCache } from '../../core/index.js';
import { reloadFromCache } from '../mcp-boot.js';
import { createMcpServer, setGraphState, setSnapshotLoader } from '../../server/index.js';
import type { SystemGraph, Finding, AnalysisProvenance } from '../../types.js';

// A running server booted from one cache while `infrawise analyze` in another
// terminal wrote a new one. Without this reload the session served the boot
// snapshot forever and re-running analyze changed nothing.
describe('cache reload', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-reload-'));
    setCacheDir(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const graph = (name: string): SystemGraph => ({
    nodes: [{ id: `bucket:aws:${name}`, type: 'bucket', name, provider: 'aws' }],
    edges: [],
  });

  it('picks up an analysis written after boot, once', async () => {
    writeCache('graph', graph('before'));
    writeCache('findings', [] as Finding[]);
    expect(reloadFromCache()?.graph.nodes[0]).toMatchObject({ name: 'before' });
    // Nothing has moved since, so a second call is a no-op.
    expect(reloadFromCache()).toBeNull();

    // A real analyze takes seconds; the wait only separates the two writes into
    // distinct millisecond timestamps.
    await new Promise((r) => setTimeout(r, 5));
    writeCache('graph', graph('after'));
    writeCache('findings', [] as Finding[]);

    expect(reloadFromCache()?.graph.nodes[0]).toMatchObject({ name: 'after' });
    expect(reloadFromCache()).toBeNull();
  });

  it('returns null when only findings are readable', () => {
    writeCache('findings', [] as Finding[]);
    expect(reloadFromCache()).toBeNull();
  });

  // Backdates a cache entry in place, keeping the version field the writer used.
  function backdate(key: string, ms: number): void {
    const file = path.join(dir, '.infrawise', 'cache', `${key}.json`);
    const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as { timestamp: number };
    entry.timestamp -= ms;
    fs.writeFileSync(file, JSON.stringify(entry));
  }

  async function overviewBuckets(): Promise<string[]> {
    return (await overview()).buckets.map((b: { name: string }) => b.name);
  }

  async function overviewHealth() {
    return (await overview()).dataHealth;
  }

  async function overview() {
    const mcp = createMcpServer();
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await mcp.connect(st);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(ct);
    try {
      const res = (await client.callTool({ name: 'get_infra_overview', arguments: {} })) as {
        content: { text: string }[];
      };
      return JSON.parse(res.content[0].text);
    } finally {
      await client.close();
    }
  }

  it('a tool call sees an analysis written after the server booted', async () => {
    // The reported bug: server up, `infrawise analyze` run in another terminal,
    // and every tool kept answering from the boot snapshot. The wiring under
    // test is logged() -> refreshIfCacheMoved() -> the loader.
    writeCache('graph', graph('boot-bucket'));
    writeCache('findings', [] as Finding[]);
    reloadFromCache();
    setSnapshotLoader(reloadFromCache);
    try {
      expect(await overviewBuckets()).toEqual(['boot-bucket']);

      await new Promise((r) => setTimeout(r, 5));
      writeCache('graph', graph('analyzed-later'));
      writeCache('findings', [] as Finding[]);

      expect(await overviewBuckets()).toEqual(['analyzed-later']);
    } finally {
      setSnapshotLoader(null);
      setGraphState({ nodes: [], edges: [] }, []);
    }
  });

  it('picks up a code refresh’s write without moving the freshness clock', async () => {
    const analyzedAt = Date.now() - 4 * 3600_000;
    writeCache('provenance', {
      analyzedAt,
      sources: [{ service: 'sqs', status: 'ok' }],
    } as AnalysisProvenance);
    writeCache('graph', graph('before'));
    writeCache('findings', [] as Finding[]);
    reloadFromCache();

    // What a file save does: rebuild the graph from cached cloud metadata and
    // write it. No AWS was read, so the cloud facts are exactly as old as before.
    await new Promise((r) => setTimeout(r, 5));
    writeCache('graph', graph('after-edit'));
    writeCache('findings', [] as Finding[]);

    expect(reloadFromCache()?.graph.nodes[0]).toMatchObject({ name: 'after-edit' });
    expect((await overviewHealth()).analyzedAt).toBe(new Date(analyzedAt).toISOString());
  });

  it('keeps provenance and analyzedAt on an analysis older than an hour', async () => {
    const analyzedAt = Date.now() - 2 * 3600_000;
    writeCache('provenance', {
      analyzedAt,
      region: 'us-west-2',
      profile: 'lab5',
      sources: [{ service: 'sqs', status: 'ok' }],
    } as AnalysisProvenance);
    // A 1h TTL used to drop this entry, wiping analyzedAt and sources while the
    // graph kept its real data — dataHealth then denied an analysis it was serving.
    backdate('provenance', 2 * 3600_000);
    writeCache('graph', graph('orders'));
    writeCache('findings', [] as Finding[]);
    reloadFromCache();

    const health = await overviewHealth();
    expect(health.analyzedAt).toBe(new Date(analyzedAt).toISOString());
    expect(health.profile).toBe('lab5');
    expect(health.sources).toHaveLength(1);
    expect(health.iac.reason).not.toMatch(/predates source tracking/);
  });
});
