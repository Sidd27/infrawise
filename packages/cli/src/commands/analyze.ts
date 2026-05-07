import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, formatError, writeCache } from '@infrawise/core';
import { extractDynamoMetadata } from '@infrawise/adapters-dynamodb';
import { extractPostgresMetadata } from '@infrawise/adapters-postgres';
import { extractMySQLMetadata } from '@infrawise/adapters-mysql';
import { extractMongoMetadata } from '@infrawise/adapters-mongodb';
import { extractIaCSchema } from '@infrawise/adapters-terraform';
import { scanRepository } from '@infrawise/context';
import { buildGraph } from '@infrawise/graph';
import { runAllAnalyzers, IaCDriftAnalyzer } from '@infrawise/analyzers';
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
  const mysqlMeta: Awaited<ReturnType<typeof extractMySQLMetadata>> = [];
  const mongoMeta: Awaited<ReturnType<typeof extractMongoMetadata>> = [];

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

  // MySQL
  if (config.mysql?.enabled && config.mysql.connectionString) {
    const spin = ora({ text: chalk.dim('Extracting MySQL schema...'), color: 'cyan' }).start();
    try {
      const result = await extractMySQLMetadata(config.mysql.connectionString);
      mysqlMeta.push(...result);
      spin.succeed(chalk.green('MySQL') + chalk.dim(`  ${result.length} table(s) found`));
    } catch (err) {
      spin.warn(chalk.yellow('MySQL skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // MongoDB
  if (config.mongodb?.enabled && config.mongodb.connectionString) {
    const spin = ora({ text: chalk.dim('Extracting MongoDB schema...'), color: 'cyan' }).start();
    try {
      const result = await extractMongoMetadata(
        config.mongodb.connectionString,
        config.mongodb.databases,
      );
      mongoMeta.push(...result);
      spin.succeed(chalk.green('MongoDB') + chalk.dim(`  ${result.length} collection(s) found`));
    } catch (err) {
      spin.warn(chalk.yellow('MongoDB skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // IaC schema extraction
  let iacDriftAnalyzer: IaCDriftAnalyzer | undefined;
  {
    const spin = ora({ text: chalk.dim('Extracting IaC schema (Terraform/CloudFormation)...'), color: 'cyan' }).start();
    try {
      const iacSchema = await extractIaCSchema(repoPath);
      const totalIaC = iacSchema.dynamoTables.length + iacSchema.rdsInstances.length + iacSchema.mongoClusters.length;
      iacDriftAnalyzer = new IaCDriftAnalyzer();
      iacDriftAnalyzer.setIaCSchema(iacSchema);
      spin.succeed(chalk.green('IaC schema') + chalk.dim(`  ${totalIaC} resource(s) found`));
    } catch (err) {
      spin.warn(chalk.yellow('IaC scan skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
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
    var graph = buildGraph(operations, dynamoMeta, postgresMeta, mysqlMeta, mongoMeta);
    spin.succeed(chalk.green('Graph built') + chalk.dim(`  ${graph.nodes.length} nodes, ${graph.edges.length} edges`));
  }

  // Analyzers
  const findings = await (async () => {
    const spin = ora({ text: chalk.dim('Running analyzers...'), color: 'cyan' }).start();
    // Build analyzer list with IaC drift analyzer if available
    const { FullTableScanAnalyzer, MissingGSIAnalyzer, HotPartitionAnalyzer,
            MissingIndexAnalyzer, NplusOneAnalyzer, LargeSelectAnalyzer,
            MissingMySQLIndexAnalyzer, MySQLFullTableScanAnalyzer,
            MissingMongoIndexAnalyzer, MongoCollectionScanAnalyzer } = await import('@infrawise/analyzers');
    const analyzers = [
      new FullTableScanAnalyzer(),
      new MissingGSIAnalyzer(),
      new HotPartitionAnalyzer(),
      new MissingIndexAnalyzer(),
      new NplusOneAnalyzer(),
      new LargeSelectAnalyzer(),
      new MissingMySQLIndexAnalyzer(),
      new MySQLFullTableScanAnalyzer(),
      new MissingMongoIndexAnalyzer(),
      new MongoCollectionScanAnalyzer(),
      ...(iacDriftAnalyzer ? [iacDriftAnalyzer] : []),
    ];
    const result = await runAllAnalyzers(graph, analyzers);
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
