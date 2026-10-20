import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, logger, readCache, readCacheTimestamp, setCacheDir } from '../core/index.js';
import {
  setGraphState,
  setServerConfig,
  setSnapshotLoader,
  setCodeRefreshError,
} from '../server/index.js';
import type { SystemGraph, Finding, InfrawiseConfig, AnalysisProvenance } from '../types.js';

const WATCHED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'];

// Build output and vendored trees churn constantly (cdk synth, tsc --watch, a
// bundler) and the scanner already skips them, so a refresh triggered from one
// is pure cost: a full re-analysis that cannot change the result.
const IGNORED_DIRS = new Set([
  'node_modules',
  '.infrawise',
  '.git',
  'cdk.out',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
]);

export function triggersRefresh(filename: string): boolean {
  if (
    !WATCHED_EXTS.includes(path.extname(filename)) &&
    !/^tsconfig.*\.json$/.test(path.basename(filename))
  )
    return false;
  return !filename.split(/[\\/]/).some((segment) => IGNORED_DIRS.has(segment));
}

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
  options: { deferSnapshot?: boolean; onLoaded?(config: InfrawiseConfig | undefined): void } = {},
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
  let initialLoad: Promise<void> | undefined;
  if (options.deferSnapshot) {
    setSnapshotLoader(async () => {
      initialLoad ??= loadSnapshot().catch((err) => {
        initialLoad = undefined;
        throw err;
      });
      await initialLoad;
      return reloadFromCache();
    });
  } else {
    setSnapshotLoader(reloadFromCache);
    await loadSnapshot();
  }

  async function loadSnapshot(): Promise<void> {
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
      const { runAnalyze } = await import('./commands/analyze.js');
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
    options.onLoaded?.(config);
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
  let pendingCloud = false;
  let configChanged = false;
  const pending = new Set<string>();
  let scanner: import('../context/incremental.js').RepositoryScanner | undefined;

  const refresh = async () => {
    if (refreshing || (pending.size === 0 && !pendingCloud)) return;
    refreshing = true;
    const changedFiles = [...pending];
    pending.clear();
    let succeeded = false;
    const refreshCloud = pendingCloud;
    pendingCloud = false;
    hooks.onStart?.();
    try {
      const { runCodeRefresh, runAnalyze } = await import('./commands/analyze.js');
      if (refreshCloud) {
        await runAnalyze({ repo: repoPath, config: configFile, silent: true });
        scanner = undefined;
        const snapshot = reloadFromCache();
        if (snapshot) hooks.onDone(snapshot.graph, snapshot.findings);
        succeeded = true;
        return;
      }
      const { RepositoryScanner } = await import('../context/incremental.js');
      scanner ??= new RepositoryScanner(repoPath);
      const currentScanner = scanner;
      const { graph, findings } = await runCodeRefresh(repoPath, cfg, () =>
        currentScanner.scan(changedFiles),
      );
      hooks.onDone(graph, findings);
      setCodeRefreshError(null);
      succeeded = true;
    } catch (err) {
      setCodeRefreshError(err instanceof Error ? err.message : String(err));
      for (const file of changedFiles) pending.add(file);
      hooks.onError?.(err);
    } finally {
      refreshing = false;
      if (succeeded && (pending.size > 0 || pendingCloud))
        debounceTimer = setTimeout(refresh, pendingCloud ? 0 : 2000);
    }
  };

  try {
    fs.watch(repoPath, { recursive: true }, (_, filename) => {
      if (!filename) return;
      if (path.join(repoPath, filename) === configFile) {
        configChanged = true;
        hooks.onConfigChange?.();
        return;
      }
      if (!triggersRefresh(filename)) return;
      logger.debug(`Code change detected: ${filename}`);
      pending.add(filename);

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refresh, 2000);
    });
  } catch {
    // fs.watch may not support recursive on all platforms — silently skip
  }
  if (cfg.freshness?.refreshIntervalMinutes) {
    setInterval(() => {
      if (configChanged) return;
      pendingCloud = true;
      void refresh();
    }, cfg.freshness.refreshIntervalMinutes * 60_000).unref();
  }
}
