import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, readCache, readCacheTimestamp, setCacheDir } from '../../core/index.js';
import { createServer, setGraphState, setConfigured } from '../../server/index.js';
import type { SystemGraph, Finding, InfrawiseConfig } from '../../types.js';
import { log, printHeader } from '../utils.js';
import { runAnalyze, runCodeRefresh } from './analyze.js';
import { runStdio } from './stdio.js';

interface ServeOptions {
  config?: string;
  stdio?: boolean;
  port?: number;
}

const BOX_W = 52;

const TOOL_MAP: Array<{ name: string; service?: string }> = [
  { name: 'get_infra_overview' },
  { name: 'get_graph_summary' },
  { name: 'get_table_schema' },
  { name: 'analyze_function' },
  { name: 'suggest_gsi', service: 'dynamodb' },
  { name: 'postgres_index_suggestions', service: 'postgres' },
  { name: 'suggest_mongo_index', service: 'mongodb' },
  { name: 'mysql_index_suggestions', service: 'mysql' },
  { name: 'get_queue_details', service: 'sqs' },
  { name: 'get_topic_details', service: 'sns' },
  { name: 'get_secrets_overview', service: 'secretsManager' },
  { name: 'get_parameter_overview', service: 'ssm' },
  { name: 'get_lambda_overview', service: 'lambda' },
  { name: 'get_eventbridge_details', service: 'eventbridge' },
  { name: 'get_s3_overview', service: 's3' },
  { name: 'get_api_routes', service: 'apiGateway' },
  { name: 'get_log_errors', service: 'cloudwatchLogs' },
  { name: 'get_stack_outputs', service: 'terraform' },
  { name: 'get_cognito_overview', service: 'cognito' },
  { name: 'get_stream_details', service: 'kinesis' },
  { name: 'get_cache_overview', service: 'elasticache' },
];

// With no config every registered tool is shown as active (the server exposes
// all of them); a config narrows the list to its enabled services.
function isEnabled(cfg: InfrawiseConfig | undefined, service?: string): boolean {
  if (!service || !cfg) return true;
  const svc = (cfg as unknown as Record<string, { enabled?: boolean } | undefined>)[service];
  return svc?.enabled === true;
}

function boxLine(visibleContent: string, coloredContent: string): void {
  const padding = ' '.repeat(Math.max(0, BOX_W - visibleContent.length));
  console.log(chalk.dim('  │') + coloredContent + padding + chalk.dim('│'));
}

function boxDivider(): void {
  console.log(chalk.dim('  ├────────────────────────────────────────────────────┤'));
}

function groupTools(tools: string[]): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < tools.length) {
    const a = tools[i];
    const b = tools[i + 1];
    if (b && `  ${a} · ${b}`.length <= BOX_W) {
      lines.push(`${a} · ${b}`);
      i += 2;
    } else {
      lines.push(a);
      i++;
    }
  }
  return lines;
}

export async function runServe(options: ServeOptions = {}): Promise<void> {
  if (options.stdio) {
    await runStdio(options.config);
    return;
  }

  const port = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

  printHeader('MCP Server');

  setCacheDir(path.dirname(path.resolve(options.config ?? 'infrawise.yaml')));

  // A hosted MCP runtime may launch the server with no infrawise.yaml. Start
  // anyway with an empty graph so the host can connect and list tools.
  let config: InfrawiseConfig | undefined;
  try {
    config = loadConfig(options.config);
    log.success('Config loaded', options.config ?? 'infrawise.yaml');
  } catch (err) {
    log.warn(
      `Starting with empty graph (no config loaded): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  setConfigured(config !== undefined);

  const repoPath = process.cwd();

  // Auto-analyze if no cache
  const cachedGraph = readCache<SystemGraph>('graph');
  const cachedFindings = readCache<Finding[]>('findings');

  if (cachedGraph && cachedFindings) {
    log.success(
      'Cached analysis loaded',
      `${cachedGraph.nodes.length} nodes · ${cachedGraph.edges.length} edges · ${cachedFindings.length} finding(s)`,
    );
    setGraphState(cachedGraph, cachedFindings, readCacheTimestamp('graph'));
  } else if (config) {
    log.warn('No cache found — running analysis now...');
    console.log('');
    await runAnalyze({ repo: repoPath, config: options.config });
    const freshGraph = readCache<SystemGraph>('graph') ?? { nodes: [], edges: [] };
    const freshFindings = readCache<Finding[]>('findings') ?? [];
    setGraphState(freshGraph, freshFindings, readCacheTimestamp('graph'));
  } else {
    setGraphState({ nodes: [], edges: [] }, [], null);
  }

  console.log('');

  // Start server
  const spin = ora({ text: chalk.dim('Starting server...'), color: 'cyan' }).start();
  const { start } = createServer(port);
  await start();
  spin.succeed(chalk.green('Server running'));

  // Compute active/inactive tools from config
  const activeTools = TOOL_MAP.filter((t) => isEnabled(config, t.service)).map((t) => t.name);
  const inactiveTools = TOOL_MAP.filter((t) => !isEnabled(config, t.service)).map((t) => t.name);

  // URL rows
  const mcpUrl = `http://localhost:${port}/mcp`;
  const healthUrl = `http://localhost:${port}/health`;

  // Print box
  console.log('');
  console.log(chalk.dim('  ┌────────────────────────────────────────────────────┐'));
  boxLine('  MCP Server', chalk.bold('  MCP Server'));
  boxDivider();
  boxLine(`  POST ${mcpUrl}`, `  ${chalk.dim('POST')} ${chalk.cyan(mcpUrl)}`);
  boxLine(`  GET  ${healthUrl}`, `  ${chalk.dim('GET')}  ${chalk.cyan(healthUrl)}`);
  boxDivider();

  const activeLabel = `  Tools (${activeTools.length} active${inactiveTools.length > 0 ? ` · ${inactiveTools.length} off` : ''})`;
  boxLine(activeLabel, chalk.dim(activeLabel));

  for (const line of groupTools(activeTools)) {
    boxLine(`  ${line}`, `  ${line}`);
  }

  if (inactiveTools.length > 0) {
    boxDivider();
    boxLine('  Off (enable in infrawise.yaml):', chalk.dim('  Off (enable in infrawise.yaml):'));
    for (const line of groupTools(inactiveTools)) {
      boxLine(`  ${line}`, chalk.dim(`  ${line}`));
    }
  }

  console.log(chalk.dim('  └────────────────────────────────────────────────────┘'));
  console.log('');
  console.log(chalk.dim('  Add via CLI:'));
  console.log(chalk.dim(`  claude mcp add --transport http infrawise ${mcpUrl}`));
  console.log('');
  console.log(chalk.dim('  Watching for file changes... Press Ctrl+C to stop\n'));

  // File watch — re-run code analysis on save (needs a config to drive analyzers)
  if (config) {
    const cfg = config;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshing = false;
    const configFile = path.resolve(options.config ?? 'infrawise.yaml');

    try {
      fs.watch(repoPath, { recursive: true }, (_, filename) => {
        if (!filename) return;
        const abs = path.join(repoPath, filename);

        if (abs === configFile) {
          console.log(chalk.dim('\n  infrawise.yaml changed — restart to apply config changes\n'));
          return;
        }

        const ext = path.extname(filename);
        if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return;
        if (filename.includes('node_modules') || filename.startsWith('.infrawise')) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          if (refreshing) return;
          refreshing = true;
          const spin = ora({
            text: chalk.dim('Refreshing code analysis...'),
            color: 'cyan',
          }).start();
          try {
            const { graph, findings } = await runCodeRefresh(repoPath, cfg);
            setGraphState(graph, findings);
            spin.succeed(
              chalk.green('Analysis refreshed') +
                chalk.dim(`  ${graph.nodes.length} nodes · ${findings.length} finding(s)`),
            );
          } catch (err) {
            spin.warn(
              chalk.yellow('Refresh failed') +
                chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`),
            );
          } finally {
            refreshing = false;
          }
        }, 2000);
      });
    } catch {
      // fs.watch may not support recursive on all platforms — silently skip
    }
  }

  process.on('SIGINT', () => {
    console.log(chalk.dim('\n  Shutting down...\n'));
    process.exit(0);
  });

  await new Promise<never>(() => {});
}
