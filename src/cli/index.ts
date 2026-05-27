#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import { printBanner } from './utils.js';
import { runInit } from './commands/init.js';
import { runAuth } from './commands/auth.js';
import { runAnalyze } from './commands/analyze.js';
import { runDev } from './commands/dev.js';
import { runDoctor } from './commands/doctor.js';
import { runStdio } from './commands/stdio.js';

const { version } = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string };

const program = new Command();

program
  .name('infrawise')
  .description('CLI-first infrastructure intelligence platform — analyze your databases, AWS services, and IaC')
  .version(version);

program
  .command('init')
  .description('Detect AWS profile/region, discover DynamoDB tables, and generate infrawise.yaml')
  .option('--force', 'Overwrite existing infrawise.yaml')
  .action(async (options) => {
    printBanner();
    await runInit({ force: options.force });
  });

program
  .command('auth')
  .description('Validate and select AWS profile from ~/.aws/credentials')
  .action(async () => {
    printBanner();
    await runAuth();
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
  .command('dev')
  .description('Start Fastify MCP server on localhost:3000')
  .option('-c, --config <path>', 'Path to infrawise.yaml', 'infrawise.yaml')
  .option('-p, --port <number>', 'Port to listen on', '3000')
  .action(async (options) => {
    printBanner();
    await runDev({
      config: options.config !== 'infrawise.yaml' ? options.config : undefined,
      port: parseInt(options.port, 10),
    });
  });

program
  .command('stdio')
  .description('Start MCP server on stdio transport (for Claude Desktop and Glama)')
  .option('-c, --config <path>', 'Path to infrawise.yaml', 'infrawise.yaml')
  .action(async (options) => {
    await runStdio(options.config !== 'infrawise.yaml' ? options.config : undefined);
  });

program
  .command('doctor')
  .description('Validate AWS access, postgres connectivity, config, and repo scan')
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
