import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { writeCache } from '../../core/index.js';
import { loadGraphState } from '../mcp-boot.js';
import { createMcpServer, setGraphState, setSnapshotLoader } from '../../server/index.js';

const mocks = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock('../commands/analyze.js', () => ({ runAnalyze: mocks.analyze }));

describe('deferred MCP startup', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-startup-'));
    fs.writeFileSync(path.join(dir, 'infrawise.yaml'), 'project: startup-test\n');
    setGraphState({ nodes: [], edges: [] }, []);
    mocks.analyze.mockReset();
  });
  afterEach(() => {
    setSnapshotLoader(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('connects and lists tools without analyzing, then shares one cold analysis between tool calls', async () => {
    let finish: () => void = () => {};
    mocks.analyze.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onLoaded = vi.fn();
    await loadGraphState(path.join(dir, 'infrawise.yaml'), { ok() {}, warn() {} }, true, {
      deferSnapshot: true,
      onLoaded,
    });
    const server = createMcpServer();
    const client = new Client({ name: 'test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools).toHaveLength(22);
      expect(mocks.analyze).not.toHaveBeenCalled();
      expect(onLoaded).not.toHaveBeenCalled();
      const first = client.callTool({ name: 'get_infra_overview', arguments: {} });
      const second = client.callTool({ name: 'get_graph_summary', arguments: {} });
      await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
      writeCache('graph', { nodes: [], edges: [] });
      writeCache('findings', []);
      writeCache('provenance', { analyzedAt: Date.now(), sources: [] });
      finish();
      const responses = await Promise.all([first, second]);
      expect(responses.every((response) => !response.isError)).toBe(true);
      expect(onLoaded).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('loads an existing snapshot on first use without reanalyzing', async () => {
    const onLoaded = vi.fn();
    await loadGraphState(path.join(dir, 'infrawise.yaml'), { ok() {}, warn() {} }, true, {
      deferSnapshot: true,
      onLoaded,
    });
    writeCache('graph', { nodes: [], edges: [] });
    writeCache('findings', []);
    const server = createMcpServer();
    const client = new Client({ name: 'test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect(onLoaded).not.toHaveBeenCalled();
      expect(
        (await client.callTool({ name: 'get_infra_overview', arguments: {} })).isError,
      ).not.toBe(true);
      expect(mocks.analyze).not.toHaveBeenCalled();
      expect(onLoaded).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
