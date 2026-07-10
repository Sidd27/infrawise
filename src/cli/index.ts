#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import { printBanner } from './utils.js';
import { runAnalyze } from './commands/analyze.js';
import { runCheck } from './commands/check.js';
import { runServe } from './commands/serve.js';
import { runDoctor } from './commands/doctor.js';
import { runStdio } from './commands/stdio.js';
import { runStart } from './commands/start.js';

const { version } = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
) as { version: string };

const program = new Command();

program
  .name('infrawise')
  .description(
    'CLI-first infrastructure intelligence platform — analyze your databases, AWS services, and IaC',
  )
  .version(version);

program
  .command('start')
  .description('Probe environment, generate config, analyze, and connect your editor')
  .option('-c, --config <path>', 'Path to infrawise.yaml', 'infrawise.yaml')
  .option('--claude', 'Write .mcp.json and open Claude Code')
  .option('--cursor', 'Write .cursor/mcp.json and open Cursor')
  .option('--vscode', 'Write .vscode/mcp.json and open VS Code')
  .option('--interactive', 'Run interactive setup wizard instead of auto-discovery')
  .option('--rediscover', 'Delete existing infrawise.yaml and re-probe the environment')
  .action(async (options) => {
    printBanner();
    await runStart({
      config: options.config !== 'infrawise.yaml' ? options.config : undefined,
      claude: options.claude,
      cursor: options.cursor,
      vscode: options.vscode,
      interactive: options.interactive,
      rediscover: options.rediscover,
    });
  });

program
  .command('analyze')
  .description('Load config, run extractors, build graph, and run all analyzers')
  .option('-c, --config <path>', 'Path to infrawise.yaml', 'infrawise.yaml')
  .option('-r, --repo <path>', 'Path to repository to scan', process.cwd())
  .option('--no-cache', 'Skip reading/writing the cache')
  .option('-o, --output <path>', 'Save findings as a markdown report (e.g. report.md)')
  .option('--severity <level>', 'Only show findings at or above this level: high | medium | low')
  .action(async (options) => {
    printBanner();
    await runAnalyze({
      config: options.config !== 'infrawise.yaml' ? options.config : undefined,
      repo: options.repo,
      noCache: !options.cache,
      output: options.output,
      severity: options.severity,
    });
  });

program
  .command('check')
  .description('CI gate: analyze and exit non-zero if findings reach the threshold severity')
  .option('-c, --config <path>', 'Path to infrawise.yaml', 'infrawise.yaml')
  .option('-r, --repo <path>', 'Path to repository to scan', process.cwd())
  .option('--fail-on <level>', 'Severity that fails the build: high | medium | low', 'high')
  .action(async (options) => {
    printBanner();
    await runCheck({
      config: options.config !== 'infrawise.yaml' ? options.config : undefined,
      repo: options.repo,
      failOn: options.failOn,
    });
  });

program
  .command('serve')
  .description('Start the MCP server — HTTP by default, or stdio for editor integration')
  .option('-c, --config <path>', 'Path to infrawise.yaml', 'infrawise.yaml')
  .option('--stdio', 'Use stdio transport (for editors via .mcp.json) instead of HTTP')
  .option('-p, --port <number>', 'Port to listen on (HTTP only)', '3000')
  .action(async (options) => {
    if (!options.stdio) printBanner();
    await runServe({
      config: options.config !== 'infrawise.yaml' ? options.config : undefined,
      stdio: options.stdio,
      port: parseInt(options.port, 10),
    });
  });

// Hidden backcompat alias: editors launched from a .mcp.json generated before
// `serve` existed still invoke `infrawise stdio`. Kept out of --help.
program
  .command('stdio', { hidden: true })
  .option('-c, --config <path>', 'Path to infrawise.yaml', 'infrawise.yaml')
  .action(async (options) => {
    await runStdio(options.config !== 'infrawise.yaml' ? options.config : undefined);
  });

program
  .command('doctor')
  .description('Diagnostic escape hatch: validate AWS/DB access, config, and repo scan')
  .option('-c, --config <path>', 'Path to infrawise.yaml', 'infrawise.yaml')
  .action(async (options) => {
    printBanner();
    await runDoctor({
      config: options.config !== 'infrawise.yaml' ? options.config : undefined,
    });
  });

// Global error handling
program.exitOverride((err) => {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(0);
  }
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('\nUnhandled error:', reason instanceof Error ? reason.message : String(reason));
  process.exit(1);
});

program.parse(process.argv);
