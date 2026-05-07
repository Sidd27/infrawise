#!/usr/bin/env node
import { Command } from 'commander';
import { printBanner } from './utils';
import { runInit } from './commands/init';
import { runAuth } from './commands/auth';
import { runAnalyze } from './commands/analyze';
import { runDev } from './commands/dev';
import { runDoctor } from './commands/doctor';

const program = new Command();

program
  .name('infrawise')
  .description('CLI-first infrastructure intelligence platform for DynamoDB and PostgreSQL')
  .version('0.1.0');

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
  .action(async (options) => {
    printBanner();
    await runAnalyze({
      config: options.config !== 'infrawise.yaml' ? options.config : undefined,
      repo: options.repo,
      noCache: !options.cache,
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
