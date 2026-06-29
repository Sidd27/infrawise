import * as fs from 'fs';
import * as path from 'path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, readCache, readCacheTimestamp, setCacheDir } from '../../core/index.js';
import { createMcpServer, setGraphState, setConfigured } from '../../server/index.js';
import type { SystemGraph, Finding, InfrawiseConfig } from '../../types.js';
import { runAnalyze, runCodeRefresh } from './analyze.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function runStdio(configPath?: string): Promise<void> {
  const resolvedConfigPath = configPath ?? 'infrawise.yaml';
  setCacheDir(path.dirname(path.resolve(resolvedConfigPath)));

  // A hosted MCP runtime (e.g. Glama) launches the server with no infrawise.yaml.
  // Start anyway with an empty graph so the host can connect and list tools;
  // analysis populates once a config is present.
  let config: InfrawiseConfig | undefined;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    process.stderr.write(
      `infrawise: starting with empty graph (no config loaded: ${err instanceof Error ? err.message : String(err)})\n`,
    );
  }
  setConfigured(config !== undefined);

  const cachedGraph = readCache<SystemGraph>('graph', CACHE_TTL_MS);
  const cachedFindings = readCache<Finding[]>('findings', CACHE_TTL_MS);

  if (cachedGraph && cachedFindings) {
    setGraphState(cachedGraph, cachedFindings, readCacheTimestamp('graph'));
  } else if (config) {
    await runAnalyze({ config: configPath });
    const graph = readCache<SystemGraph>('graph', CACHE_TTL_MS) ?? { nodes: [], edges: [] };
    const findings = readCache<Finding[]>('findings', CACHE_TTL_MS) ?? [];
    setGraphState(graph, findings, readCacheTimestamp('graph'));
  } else {
    setGraphState({ nodes: [], edges: [] }, [], null);
  }

  // File watching drives runCodeRefresh, which needs a config — skip it without one.
  // stderr is safe in stdio transport; stdout is reserved for MCP JSON-RPC.
  if (config) {
    const cfg = config;
    const repoPath = process.cwd();
    const configFile = path.resolve(resolvedConfigPath);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshing = false;

    try {
      fs.watch(repoPath, { recursive: true }, (_, filename) => {
        if (!filename) return;
        const abs = path.join(repoPath, filename);
        if (abs === configFile) return;
        const ext = path.extname(filename);
        if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return;
        if (filename.includes('node_modules') || filename.startsWith('.infrawise')) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          if (refreshing) return;
          refreshing = true;
          try {
            const { graph, findings } = await runCodeRefresh(repoPath, cfg);
            setGraphState(graph, findings);
            process.stderr.write(
              `infrawise: code graph refreshed (${graph.nodes.length} nodes · ${findings.length} finding(s))\n`,
            );
          } catch {
            // don't break the MCP connection on watcher errors
          } finally {
            refreshing = false;
          }
        }, 2000);
      });
    } catch {
      // fs.watch recursive not supported on all platforms — silently skip
    }
  }

  const mcp = createMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
