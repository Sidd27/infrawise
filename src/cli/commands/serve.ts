import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { createServer, TOOLS } from '../../server/index.js';
import type { InfrawiseConfig } from '../../types.js';
import { log, printHeader, boxRow, rule } from '../utils.js';
import { loadGraphState, watchCode } from '../mcp-boot.js';
import { runStdio } from './stdio.js';

interface ServeOptions {
  config?: string;
  stdio?: boolean;
  port?: number;
}

const BOX_W = 52;

// With no config every registered tool is shown as active (the server exposes
// all of them); a config narrows the list to its enabled services.
function isEnabled(cfg: InfrawiseConfig | undefined, service?: string): boolean {
  if (!service || !cfg) return true;
  const svc = (cfg as unknown as Record<string, { enabled?: boolean } | undefined>)[service];
  return svc?.enabled === true;
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

  const config = await loadGraphState(
    options.config,
    { ok: log.success, warn: (msg) => log.warn(msg) },
    false,
  );

  console.log('');

  const spin = ora({ text: chalk.dim('Starting server...'), color: 'cyan' }).start();
  const { start } = createServer(port);
  await start();
  spin.succeed(chalk.green('Server running'));

  const activeTools = TOOLS.filter((t) => isEnabled(config, t.service)).map((t) => t.name);
  const inactiveTools = TOOLS.filter((t) => !isEnabled(config, t.service)).map((t) => t.name);

  const mcpUrl = `http://localhost:${port}/mcp`;
  const healthUrl = `http://localhost:${port}/health`;

  console.log('');
  console.log(rule('┌', '┐', BOX_W));
  console.log(boxRow(chalk.bold('  MCP Server'), BOX_W));
  console.log(rule('├', '┤', BOX_W));
  console.log(boxRow(`  ${chalk.dim('POST')} ${chalk.cyan(mcpUrl)}`, BOX_W));
  console.log(boxRow(`  ${chalk.dim('GET')}  ${chalk.cyan(healthUrl)}`, BOX_W));
  console.log(rule('├', '┤', BOX_W));

  const activeLabel = `  Tools (${activeTools.length} active${inactiveTools.length > 0 ? ` · ${inactiveTools.length} off` : ''})`;
  console.log(boxRow(chalk.dim(activeLabel), BOX_W));

  for (const line of groupTools(activeTools)) {
    console.log(boxRow(`  ${line}`, BOX_W));
  }

  if (inactiveTools.length > 0) {
    console.log(rule('├', '┤', BOX_W));
    console.log(boxRow(chalk.dim('  Off (enable in infrawise.yaml):'), BOX_W));
    for (const line of groupTools(inactiveTools)) {
      console.log(boxRow(chalk.dim(`  ${line}`), BOX_W));
    }
  }

  console.log(rule('└', '┘', BOX_W));
  console.log('');
  console.log(chalk.dim('  Add via CLI:'));
  console.log(chalk.dim(`  claude mcp add --transport http infrawise ${mcpUrl}`));
  console.log('');
  console.log(chalk.dim('  Watching for file changes... Press Ctrl+C to stop\n'));

  // File watch — re-run code analysis on save (needs a config to drive analyzers)
  if (config) {
    const repoPath = process.cwd();

    let refreshSpin: ReturnType<typeof ora> | null = null;
    watchCode(repoPath, config, path.resolve(options.config ?? 'infrawise.yaml'), {
      onConfigChange: () =>
        console.log(chalk.dim('\n  infrawise.yaml changed — restart to apply config changes\n')),
      onStart: () => {
        refreshSpin = ora({
          text: chalk.dim('Refreshing code analysis...'),
          color: 'cyan',
        }).start();
      },
      onDone: (graph, findings) =>
        refreshSpin?.succeed(
          chalk.green('Analysis refreshed') +
            chalk.dim(`  ${graph.nodes.length} nodes · ${findings.length} finding(s)`),
        ),
      onError: (err) =>
        refreshSpin?.warn(
          chalk.yellow('Refresh failed') +
            chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`),
        ),
    });
  }

  process.on('SIGINT', () => {
    console.log(chalk.dim('\n  Shutting down...\n'));
    process.exit(0);
  });

  await new Promise<never>(() => {});
}
