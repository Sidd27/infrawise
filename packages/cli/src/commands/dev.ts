import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, formatError, readCache } from '@infrawise/core';
import { createServer, setGraphState } from '@infrawise/server';
import type { SystemGraph, Finding } from '@infrawise/shared';
import { log, printHeader } from '../utils';

interface DevOptions {
  config?: string;
  port?: number;
}

export async function runDev(options: DevOptions = {}): Promise<void> {
  const port = options.port ?? 3000;

  printHeader('MCP Server');

  // Load config
  try {
    loadConfig(options.config);
    log.success('Config loaded', options.config ?? 'infrawise.yaml');
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }

  // Load cached state
  const cachedGraph = readCache<SystemGraph>('graph');
  const cachedFindings = readCache<Finding[]>('findings');

  if (cachedGraph && cachedFindings) {
    log.success(
      'Cached analysis loaded',
      `${cachedGraph.nodes.length} nodes · ${cachedGraph.edges.length} edges · ${cachedFindings.length} finding(s)`,
    );
    setGraphState(cachedGraph, cachedFindings);
  } else {
    log.warn('No cached analysis found');
    log.dim(`Run ${chalk.cyan('infrawise analyze')} first for full results`);
    setGraphState({ nodes: [], edges: [] }, []);
  }

  console.log('');

  // Start server
  const spin = ora({ text: chalk.dim('Starting server...'), color: 'cyan' }).start();
  const { start } = createServer(port);
  await start();
  spin.succeed(chalk.green('Server running'));

  // Print endpoints box
  console.log('');
  console.log(chalk.dim('  ┌────────────────────────────────────────────────────┐'));
  console.log(chalk.dim('  │') + chalk.bold('  MCP Server                                        ') + chalk.dim('│'));
  console.log(chalk.dim('  ├────────────────────────────────────────────────────┤'));
  console.log(chalk.dim('  │') + `  ${chalk.dim('POST')} ${chalk.cyan(`http://localhost:${port}/mcp`)}           ` + chalk.dim('│'));
  console.log(chalk.dim('  │') + `  ${chalk.dim('GET')}  ${chalk.cyan(`http://localhost:${port}/mcp/tools`)}      ` + chalk.dim('│'));
  console.log(chalk.dim('  │') + `  ${chalk.dim('GET')}  ${chalk.cyan(`http://localhost:${port}/health`)}          ` + chalk.dim('│'));
  console.log(chalk.dim('  ├────────────────────────────────────────────────────┤'));
  console.log(chalk.dim('  │') + chalk.dim('  Tools: get_graph_summary · analyze_function        ') + chalk.dim('│'));
  console.log(chalk.dim('  │') + chalk.dim('         suggest_gsi · postgres_index_suggestions    ') + chalk.dim('│'));
  console.log(chalk.dim('  └────────────────────────────────────────────────────┘'));
  console.log('');
  console.log(chalk.dim('  Add to .claude/settings.json:'));
  console.log(chalk.dim('  {'));
  console.log(chalk.dim('    "mcpServers": {'));
  console.log(chalk.dim('      "infrawise": {'));
  console.log(chalk.dim(`        "url": "http://localhost:${port}/mcp"`));
  console.log(chalk.dim('      }'));
  console.log(chalk.dim('    }'));
  console.log(chalk.dim('  }'));
  console.log('');
  console.log(chalk.dim('  Press Ctrl+C to stop\n'));

  process.on('SIGINT', () => {
    console.log(chalk.dim('\n  Shutting down...\n'));
    process.exit(0);
  });

  await new Promise<never>(() => {});
}
