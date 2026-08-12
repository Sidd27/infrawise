import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, readCache, readCacheTimestamp, setCacheDir } from '../core/index.js';
import { setGraphState, setServerConfig, setSnapshotLoader } from '../server/index.js';
import type { SystemGraph, Finding, InfrawiseConfig, AnalysisProvenance } from '../types.js';
import { runAnalyze, runCodeRefresh } from './commands/analyze.js';

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
  setServerConfig(config);
  setSnapshotLoader(reloadFromCache);

  const cachedGraph = readCache<SystemGraph>('graph');
  const cachedFindings = readCache<Finding[]>('findings');

  if (cachedGraph && cachedFindings) {
    logs.ok(
      'Cached analysis loaded',
      `${cachedGraph.nodes.length} nodes · ${cachedGraph.edges.length} edges · ${cachedFindings.length} finding(s)`,
    );
    loadedAt = readCacheTimestamp('graph');
    setGraphState(cachedGraph, cachedFindings, readCache<AnalysisProvenance>('provenance'));
  } else if (config) {
    logs.warn('No cache found — running analysis now...');
    await runAnalyze({ repo: process.cwd(), config: configPath, silent });
    loadedAt = readCacheTimestamp('graph');
    setGraphState(
      readCache<SystemGraph>('graph') ?? { nodes: [], edges: [] },
      readCache<Finding[]>('findings') ?? [],
      readCache<AnalysisProvenance>('provenance'),
    );
  } else {
    setGraphState({ nodes: [], edges: [] }, []);
  }

  return config;
}

export interface WatchHooks {
  onConfigChange?(): void;
  onStart?(): void;
  onDone(graph: SystemGraph, findings: Finding[]): void;
  onError?(err: unknown): void;
}

// The analysis this process has already loaded. `infrawise analyze` in another
// terminal rewrites the cache, and the server must notice: a session that keeps
// serving its boot snapshot looks exactly like infrastructure that never moved,
// which is indistinguishable from a correct answer.
let loadedAt: number | null = null;

// Pulled on every tool call. A stat of one local file, so the check is cheaper
// than the JSON it guards; returns null when nothing moved.
export function reloadFromCache(): { graph: SystemGraph; findings: Finding[] } | null {
  const writtenAt = readCacheTimestamp('graph');
  if (writtenAt === null || writtenAt === loadedAt) return null;
  const graph = readCache<SystemGraph>('graph');
  const findings = readCache<Finding[]>('findings');
  if (!graph || !findings) return null;
  loadedAt = writtenAt;
  setGraphState(graph, findings, readCache<AnalysisProvenance>('provenance'));
  return { graph, findings };
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
