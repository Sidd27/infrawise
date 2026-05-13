import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, formatError, writeCache } from '../../core';
import { extractDynamoMetadata } from '../../adapters/dynamodb';
import { extractPostgresMetadata } from '../../adapters/postgres';
import { extractMySQLMetadata } from '../../adapters/mysql';
import { extractMongoMetadata } from '../../adapters/mongodb';
import { extractIaCSchema } from '../../adapters/terraform';
import {
  extractSQSMetadata,
  extractSNSMetadata,
  extractSSMMetadata,
  extractSecretsMetadata,
  extractLambdaMetadata,
  extractRDSMetadata,
} from '../../adapters/aws';
import { extractLogsMetadata } from '../../adapters/logs';
import { scanRepository } from '../../context';
import { buildGraph } from '../../graph';
import {
  runAllAnalyzers, IaCDriftAnalyzer,
  FullTableScanAnalyzer, MissingGSIAnalyzer, HotPartitionAnalyzer,
  MissingIndexAnalyzer, NplusOneAnalyzer, LargeSelectAnalyzer,
  MissingMySQLIndexAnalyzer, MySQLFullTableScanAnalyzer,
  MissingMongoIndexAnalyzer, MongoCollectionScanAnalyzer,
  MissingDLQAnalyzer, UnencryptedQueueAnalyzer, LargeQueueBacklogAnalyzer,
  MissingSecretRotationAnalyzer, MissingLogRetentionAnalyzer,
  LambdaDefaultMemoryAnalyzer, LambdaHighTimeoutAnalyzer,
  RDSPubliclyAccessibleAnalyzer, RDSNoBackupAnalyzer, RDSUnencryptedAnalyzer,
  RDSNoDeletionProtectionAnalyzer, RDSNoMultiAZAnalyzer,
} from '../../analyzers';
import { printFinding, printSummaryBox, log, printHeader } from '../utils';
import type { ServicesMeta, ExtractedOperation } from '../../types';

interface AnalyzeOptions {
  config?: string;
  repo?: string;
  noCache?: boolean;
}

export async function runAnalyze(options: AnalyzeOptions = {}): Promise<void> {
  printHeader('Running Analysis');

  let config;
  try {
    config = loadConfig(options.config);
    log.success('Config loaded', options.config ?? 'infrawise.yaml');
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }

  const repoPath = options.repo ?? process.cwd();
  const awsCfg = { region: config.aws?.region, profile: config.aws?.profile, endpoint: config.aws?.endpoint };

  const dynamoMeta: Awaited<ReturnType<typeof extractDynamoMetadata>> = [];
  const postgresMeta: Awaited<ReturnType<typeof extractPostgresMetadata>> = [];
  const mysqlMeta: Awaited<ReturnType<typeof extractMySQLMetadata>> = [];
  const mongoMeta: Awaited<ReturnType<typeof extractMongoMetadata>> = [];
  const servicesMeta: ServicesMeta = {};

  // ── DynamoDB ────────────────────────────────────────────────────────────────
  if (config.dynamodb?.enabled === true) {
    const spin = ora({ text: chalk.dim('Extracting DynamoDB tables...'), color: 'cyan' }).start();
    try {
      const result = await extractDynamoMetadata(config);
      dynamoMeta.push(...result);
      spin.succeed(chalk.green('DynamoDB') + chalk.dim(`  ${result.length} table(s)`));
    } catch (err) {
      spin.warn(chalk.yellow('DynamoDB skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── PostgreSQL ──────────────────────────────────────────────────────────────
  if (config.postgres?.enabled && config.postgres.connectionString) {
    const spin = ora({ text: chalk.dim('Extracting PostgreSQL schema...'), color: 'cyan' }).start();
    try {
      const result = await extractPostgresMetadata(config.postgres.connectionString);
      postgresMeta.push(...result);
      spin.succeed(chalk.green('PostgreSQL') + chalk.dim(`  ${result.length} table(s)`));
    } catch (err) {
      spin.warn(chalk.yellow('PostgreSQL skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── MySQL ───────────────────────────────────────────────────────────────────
  if (config.mysql?.enabled && config.mysql.connectionString) {
    const spin = ora({ text: chalk.dim('Extracting MySQL schema...'), color: 'cyan' }).start();
    try {
      const result = await extractMySQLMetadata(config.mysql.connectionString);
      mysqlMeta.push(...result);
      spin.succeed(chalk.green('MySQL') + chalk.dim(`  ${result.length} table(s)`));
    } catch (err) {
      spin.warn(chalk.yellow('MySQL skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── MongoDB ─────────────────────────────────────────────────────────────────
  if (config.mongodb?.enabled && config.mongodb.connectionString) {
    const spin = ora({ text: chalk.dim('Extracting MongoDB schema...'), color: 'cyan' }).start();
    try {
      const result = await extractMongoMetadata(config.mongodb.connectionString, config.mongodb.databases);
      mongoMeta.push(...result);
      spin.succeed(chalk.green('MongoDB') + chalk.dim(`  ${result.length} collection(s)`));
    } catch (err) {
      spin.warn(chalk.yellow('MongoDB skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── SQS ─────────────────────────────────────────────────────────────────────
  if (config.sqs?.enabled === true) {
    const spin = ora({ text: chalk.dim('Extracting SQS queues...'), color: 'cyan' }).start();
    try {
      const result = await extractSQSMetadata(awsCfg);
      servicesMeta.sqs = result;
      spin.succeed(chalk.green('SQS') + chalk.dim(`  ${result.length} queue(s)`));
    } catch (err) {
      spin.warn(chalk.yellow('SQS skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── SNS ─────────────────────────────────────────────────────────────────────
  if (config.sns?.enabled === true) {
    const spin = ora({ text: chalk.dim('Extracting SNS topics...'), color: 'cyan' }).start();
    try {
      const result = await extractSNSMetadata(awsCfg);
      servicesMeta.sns = result;
      spin.succeed(chalk.green('SNS') + chalk.dim(`  ${result.length} topic(s)`));
    } catch (err) {
      spin.warn(chalk.yellow('SNS skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── SSM Parameter Store ──────────────────────────────────────────────────────
  if (config.ssm?.enabled === true) {
    const spin = ora({ text: chalk.dim('Extracting SSM parameters...'), color: 'cyan' }).start();
    try {
      const result = await extractSSMMetadata({ ...awsCfg, paths: config.ssm?.paths });
      servicesMeta.ssm = result;
      spin.succeed(chalk.green('SSM') + chalk.dim(`  ${result.length} parameter(s)  `) + chalk.dim('(metadata only, no values)'));
    } catch (err) {
      spin.warn(chalk.yellow('SSM skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── Secrets Manager ──────────────────────────────────────────────────────────
  if (config.secretsManager?.enabled === true) {
    const spin = ora({ text: chalk.dim('Extracting Secrets Manager metadata...'), color: 'cyan' }).start();
    try {
      const result = await extractSecretsMetadata(awsCfg);
      servicesMeta.secrets = result;
      spin.succeed(chalk.green('Secrets Manager') + chalk.dim(`  ${result.length} secret(s)  `) + chalk.dim('(names/rotation only, no values)'));
    } catch (err) {
      spin.warn(chalk.yellow('Secrets Manager skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── Lambda ───────────────────────────────────────────────────────────────────
  if (config.lambda?.enabled === true) {
    const spin = ora({ text: chalk.dim('Extracting Lambda functions...'), color: 'cyan' }).start();
    try {
      const result = await extractLambdaMetadata(awsCfg);
      servicesMeta.lambda = result;
      spin.succeed(chalk.green('Lambda') + chalk.dim(`  ${result.length} function(s)`));
    } catch (err) {
      spin.warn(chalk.yellow('Lambda skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── RDS ──────────────────────────────────────────────────────────────────────
  if (config.rds?.enabled === true) {
    const spin = ora({ text: chalk.dim('Extracting RDS instances...'), color: 'cyan' }).start();
    try {
      const result = await extractRDSMetadata(awsCfg);
      servicesMeta.rds = result;
      spin.succeed(chalk.green('RDS') + chalk.dim(`  ${result.length} instance(s)`));
    } catch (err) {
      spin.warn(chalk.yellow('RDS skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── CloudWatch Logs ──────────────────────────────────────────────────────────
  if (config.cloudwatchLogs?.enabled) {
    const spin = ora({ text: chalk.dim('Sampling CloudWatch Logs (errors only, max 50 groups)...'), color: 'cyan' }).start();
    try {
      const result = await extractLogsMetadata({
        ...awsCfg,
        logGroupPrefixes: config.cloudwatchLogs.logGroupPrefixes,
        windowHours: config.cloudwatchLogs.windowHours,
      });
      servicesMeta.logs = result;
      const errorGroups = result.filter((lg) => lg.errorCount > 0).length;
      spin.succeed(chalk.green('CloudWatch Logs') + chalk.dim(`  ${result.length} group(s), ${errorGroups} with errors`));
    } catch (err) {
      spin.warn(chalk.yellow('CloudWatch Logs skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── IaC schema (Terraform / CloudFormation / CDK) ────────────────────────────
  let iacDriftAnalyzer: IaCDriftAnalyzer | undefined;
  {
    const spin = ora({ text: chalk.dim('Extracting IaC schema (Terraform / CloudFormation / CDK)...'), color: 'cyan' }).start();
    try {
      const iacSchema = await extractIaCSchema(repoPath);
      const total = iacSchema.dynamoTables.length + iacSchema.rdsInstances.length +
        iacSchema.mongoClusters.length + iacSchema.queues.length + iacSchema.topics.length +
        iacSchema.lambdas.length + iacSchema.buckets.length + iacSchema.parameters.length +
        iacSchema.secrets.length + iacSchema.apiGateways.length;
      iacDriftAnalyzer = new IaCDriftAnalyzer();
      iacDriftAnalyzer.setIaCSchema(iacSchema);
      spin.succeed(chalk.green('IaC schema') + chalk.dim(`  ${total} resource(s) across TF/CFN/CDK`));
    } catch (err) {
      spin.warn(chalk.yellow('IaC scan skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── Repository scan ──────────────────────────────────────────────────────────
  let operations: ExtractedOperation[];
  {
    const spin = ora({ text: chalk.dim(`Scanning ${path.basename(repoPath)} for service usage...`), color: 'cyan' }).start();
    try {
      operations = await scanRepository(repoPath);
      spin.succeed(chalk.green('Repository scanned') + chalk.dim(`  ${operations.length} service operation(s) found`));
    } catch (err) {
      spin.warn(chalk.yellow('Repository scan failed') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
      operations = [];
    }
  }

  // ── Build graph ──────────────────────────────────────────────────────────────
  let graph: ReturnType<typeof buildGraph>;
  {
    const spin = ora({ text: chalk.dim('Building infrastructure graph...'), color: 'cyan' }).start();
    graph = buildGraph(operations, dynamoMeta, postgresMeta, mysqlMeta, mongoMeta, servicesMeta);
    spin.succeed(chalk.green('Graph built') + chalk.dim(`  ${graph.nodes.length} nodes, ${graph.edges.length} edges`));
  }

  // ── Run analyzers ────────────────────────────────────────────────────────────
  let findings: Awaited<ReturnType<typeof runAllAnalyzers>>;
  {
    const spin = ora({ text: chalk.dim('Running analyzers...'), color: 'cyan' }).start();
    const analyzers = [
      ...(config.dynamodb?.enabled === true ? [
        new FullTableScanAnalyzer(),
        new MissingGSIAnalyzer(),
        new HotPartitionAnalyzer(),
      ] : []),
      ...(config.postgres?.enabled ? [
        new MissingIndexAnalyzer(),
        new NplusOneAnalyzer(),
        new LargeSelectAnalyzer(),
      ] : []),
      ...(config.mysql?.enabled ? [
        new MissingMySQLIndexAnalyzer(),
        new MySQLFullTableScanAnalyzer(),
      ] : []),
      ...(config.mongodb?.enabled ? [
        new MissingMongoIndexAnalyzer(),
        new MongoCollectionScanAnalyzer(),
      ] : []),
      ...(config.sqs?.enabled === true ? [
        new MissingDLQAnalyzer(),
        new UnencryptedQueueAnalyzer(),
        new LargeQueueBacklogAnalyzer(),
      ] : []),
      ...(config.secretsManager?.enabled === true ? [
        new MissingSecretRotationAnalyzer(),
      ] : []),
      ...(config.cloudwatchLogs?.enabled ? [
        new MissingLogRetentionAnalyzer(),
      ] : []),
      ...(config.lambda?.enabled === true ? [
        new LambdaDefaultMemoryAnalyzer(),
        new LambdaHighTimeoutAnalyzer(),
      ] : []),
      ...(config.rds?.enabled === true ? [
        new RDSPubliclyAccessibleAnalyzer(),
        new RDSNoBackupAnalyzer(),
        new RDSUnencryptedAnalyzer(),
        new RDSNoDeletionProtectionAnalyzer(),
        new RDSNoMultiAZAnalyzer(),
      ] : []),
      ...(iacDriftAnalyzer ? [iacDriftAnalyzer] : []),
    ];
    findings = await runAllAnalyzers(graph, analyzers);
    spin.succeed(chalk.green('Analysis complete') + chalk.dim(`  ${findings.length} finding(s)`));
  }

  // ── Cache ─────────────────────────────────────────────────────────────────────
  writeCache('graph', graph);
  writeCache('findings', findings);
  writeCache('operations', operations);

  // ── Output ────────────────────────────────────────────────────────────────────
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
