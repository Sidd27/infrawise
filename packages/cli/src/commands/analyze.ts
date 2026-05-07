import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, formatError, writeCache } from '@infrawise/core';
import { extractDynamoMetadata } from '@infrawise/adapters-dynamodb';
import { extractPostgresMetadata } from '@infrawise/adapters-postgres';
import { scanRepository } from '@infrawise/context';
import { buildGraph } from '@infrawise/graph';
import { runAllAnalyzers } from '@infrawise/analyzers';
import { printFinding, printSummaryBox, log, printHeader } from '../utils';

interface AnalyzeOptions {
  config?: string;
  repo?: string;
  noCache?: boolean;
}

export async function runAnalyze(options: AnalyzeOptions = {}): Promise<void> {
  printHeader('Running Analysis');

  // Load config
  let config;
  try {
    config = loadConfig(options.config);
    log.success('Config loaded', options.config ?? 'infrawise.yaml');
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }

  const repoPath = options.repo ?? process.cwd();
  const dynamoMeta: Awaited<ReturnType<typeof extractDynamoMetadata>> = [];
  const postgresMeta: Awaited<ReturnType<typeof extractPostgresMetadata>> = [];

  // DynamoDB
  {
    const spin = ora({ text: chalk.dim('Extracting DynamoDB table metadata...'), color: 'cyan' }).start();
    try {
      const result = await extractDynamoMetadata(config);
      dynamoMeta.push(...result);
      spin.succeed(chalk.green('DynamoDB') + chalk.dim(`  ${result.length} table(s) found`));
    } catch (err) {
      spin.warn(chalk.yellow('DynamoDB skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // PostgreSQL
  if (config.postgres?.enabled && config.postgres.connectionString) {
    const spin = ora({ text: chalk.dim('Extracting PostgreSQL schema...'), color: 'cyan' }).start();
    try {
      const result = await extractPostgresMetadata(config.postgres.connectionString);
      postgresMeta.push(...result);
      spin.succeed(chalk.green('PostgreSQL') + chalk.dim(`  ${result.length} table(s) found`));
    } catch (err) {
      spin.warn(chalk.yellow('PostgreSQL skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // Repository scan
  let operations: import('@infrawise/shared').ExtractedOperation[];
  {
    const spin = ora({ text: chalk.dim(`Scanning ${path.basename(repoPath)}...`), color: 'cyan' }).start();
    try {
      operations = await scanRepository(repoPath);
      spin.succeed(chalk.green('Repository scanned') + chalk.dim(`  ${operations.length} database operation(s) found`));
    } catch (err) {
      spin.warn(chalk.yellow('Repository scan failed') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
      operations = [];
    }
  }

  // Build graph
  {
    const spin = ora({ text: chalk.dim('Building infrastructure graph...'), color: 'cyan' }).start();
    var graph = buildGraph(operations, dynamoMeta, postgresMeta);
    spin.succeed(chalk.green('Graph built') + chalk.dim(`  ${graph.nodes.length} nodes, ${graph.edges.length} edges`));
  }

  // Analyzers
  const findings = await (async () => {
    const spin = ora({ text: chalk.dim('Running analyzers...'), color: 'cyan' }).start();
    const result = await runAllAnalyzers(graph);
    spin.succeed(chalk.green('Analysis complete') + chalk.dim(`  ${result.length} finding(s)`));
    return result;
  })();

  // Cache
  writeCache('graph', graph);
  writeCache('findings', findings);
  writeCache('operations', operations);

  // Output
  console.log('');
  if (findings.length === 0) {
    console.log(`  ${chalk.green.bold('✓ No issues found!')}  ${chalk.dim('Your infrastructure looks clean.')}`);
  } else {
    console.log(chalk.bold(`  Findings`) + chalk.dim(`  ${findings.length} total`));
    findings.forEach((f, i) => printFinding(f, i));
    printSummaryBox(findings);

    if (findings.some((f) => f.severity === 'high')) {
      console.log(`\n  ${chalk.red.bold('Action required:')} ${chalk.red('High severity issues detected.')}`);
    }
  }

  console.log('');
  log.dim(`Results cached in .infrawise/cache/`);
  log.info(`Run ${chalk.cyan('infrawise dev')} to explore via the MCP server`);
  console.log('');
}
