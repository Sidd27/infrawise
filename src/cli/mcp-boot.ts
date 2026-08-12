import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, readCache, readCacheTimestamp, setCacheDir } from '../core/index.js';
import { setGraphState, setConfigured, setSuggestRefreshAfterHours } from '../server/index.js';
import type { SystemGraph, Finding, InfrawiseConfig, AnalysisProvenance } from '../types.js';
import { runAnalyze, runCodeRefresh } from './commands/analyze.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WATCHED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export interface BootLog {
  ok(msg: string, detail?: string): void;
  warn(msg: string): void;
}

// Shared bootstrap for both transports: resolve the config, load or build the
// graph, and hand the config back so the caller can decide what to watch.
export async function loadGraphState(
  configPath: string | undefined,
  logs: BootLog,
  silent: boolean,
): Promise<InfrawiseConfig | undefined> {
  setCacheDir(path.dirname(path.resolve(configPath ?? 'infrawise.yaml')));

  // A hosted MCP runtime may launch the server with no infrawise.yaml. Start
  // anyway with an empty graph so the host can connect and list tools.
  let config: InfrawiseConfig | undefined;
  try {
    config = loadConfig(configPath);
    logs.ok('Config loaded', configPath ?? 'infrawise.yaml');
  } catch (err) {
    logs.warn(
      `starting with empty graph (no config loaded: ${err instanceof Error ? err.message : String(err)})`,
    );
  }
  setConfigured(config !== undefined);
  setSuggestRefreshAfterHours(config?.freshness?.suggestRefreshAfterHours);

  const cachedGraph = readCache<SystemGraph>('graph', CACHE_TTL_MS);
  const cachedFindings = readCache<Finding[]>('findings', CACHE_TTL_MS);

  if (cachedGraph && cachedFindings) {
    logs.ok(
      'Cached analysis loaded',
      `${cachedGraph.nodes.length} nodes · ${cachedGraph.edges.length} edges · ${cachedFindings.length} finding(s)`,
    );
    setGraphState(
      cachedGraph,
      cachedFindings,
      readCacheTimestamp('graph'),
      readCache<AnalysisProvenance>('provenance', CACHE_TTL_MS),
    );
  } else if (config) {
    logs.warn('No cache found — running analysis now...');
    await runAnalyze({ repo: process.cwd(), config: configPath, silent });
    setGraphState(
      readCache<SystemGraph>('graph') ?? { nodes: [], edges: [] },
      readCache<Finding[]>('findings') ?? [],
      readCacheTimestamp('graph'),
      readCache<AnalysisProvenance>('provenance'),
    );
  } else {
    setGraphState({ nodes: [], edges: [] }, [], null);
  }

  return config;
}

export interface WatchHooks {
  onConfigChange?(): void;
  onStart?(): void;
  onDone(graph: SystemGraph, findings: Finding[]): void;
  onError?(err: unknown): void;
}

// Debounced re-analysis on source change. Never throws: fs.watch has no
// recursive support on some platforms, and a watcher error must not kill the server.
export function watchCode(
  repoPath: string,
  cfg: InfrawiseConfig,
  configFile: string,
  hooks: WatchHooks,
): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshing = false;

  try {
    fs.watch(repoPath, { recursive: true }, (_, filename) => {
      if (!filename) return;
      if (path.join(repoPath, filename) === configFile) {
        hooks.onConfigChange?.();
        return;
      }
      if (!WATCHED_EXTS.includes(path.extname(filename))) return;
      if (filename.includes('node_modules') || filename.startsWith('.infrawise')) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (refreshing) return;
        refreshing = true;
        hooks.onStart?.();
        try {
          const { graph, findings } = await runCodeRefresh(repoPath, cfg);
          // A code-only refresh makes no AWS calls — it rebuilds the graph from
          // cached cloud metadata. Passing Date.now() here used to reset the
          // freshness clock on every file save, so a session reported seconds-old
          // data about infrastructure read hours earlier. The cloud read time
          // comes from provenance, which only a full analyze writes.
          setGraphState(graph, findings, null, readCache<AnalysisProvenance>('provenance'));
          hooks.onDone(graph, findings);
        } catch (err) {
          hooks.onError?.(err);
        } finally {
          refreshing = false;
        }
      }, 2000);
    });
  } catch {
    // fs.watch may not support recursive on all platforms — silently skip
  }
}
