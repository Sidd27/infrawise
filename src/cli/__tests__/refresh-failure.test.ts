import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setCacheDir, writeCache, readCache } from '../../core/index.js';
import { runCodeRefresh, runAnalyze } from '../commands/analyze.js';

vi.mock('../../adapters/iac/terraform.js', () => ({
  extractIaCSchema: vi.fn().mockRejectedValue(new Error('unreadable IaC')),
}));
afterEach(() => setCacheDir(process.cwd()));
it('rejects invalid configuration in server analysis instead of terminating the MCP process', async () => {
  await expect(
    runAnalyze({
      config: path.join(os.tmpdir(), `missing-infrawise-${Date.now()}.yaml`),
      silent: true,
    }),
  ).rejects.toThrow();
});
it('retains the snapshot rather than erasing IaC facts when a refresh cannot read IaC', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-iac-failure-'));
  try {
    setCacheDir(root);
    const graph = {
      nodes: [{ id: 'existing', type: 'stack_output', name: 'existing' }],
      edges: [],
    };
    writeCache('graph', graph);
    await expect(runCodeRefresh(root, { project: 'test' })).rejects.toThrow('IaC refresh failed');
    expect(readCache('graph')).toEqual(graph);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
