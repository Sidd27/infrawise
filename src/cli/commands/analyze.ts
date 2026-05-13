import * as fs from 'fs';
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
import type { Finding, ServicesMeta, ExtractedOperation, InfrawiseConfig } from '../../types';

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, never: 0 };

interface AnalyzeOptions {
  config?: string;
  repo?: string;
  noCache?: boolean;
  ci?: boolean;
  failOn?: 'high' | 'medium' | 'low' | 'never';
}

function mkSpinner(text: string, ci: boolean) {
  if (ci) {
    return {
      succeed: (msg: string) => console.log(`  ✓ ${msg}`),
      warn: (msg: string) => console.log(`  ⚠ ${msg}`),
    };
  }
  return ora({ text: chalk.dim(text), color: 'cyan' }).start();
}

function emitCIOutput(findings: Finding[], failOn: string): void {
  for (const f of findings) {
    const level = f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'notice';
    console.log(`::${level} title=Infrawise [${f.severity.toUpperCase()}]::${f.issue} — ${f.description}`);
  }

  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryPath) {
    const high   = findings.filter((f) => f.severity === 'high').length;
    const medium = findings.filter((f) => f.severity === 'medium').length;
    const low    = findings.filter((f) => f.severity === 'low').length;

    const rows = findings.map((f) => {
      const icon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟡' : '🔵';
      return `| ${icon} ${f.severity.toUpperCase()} | ${f.issue} | ${f.recommendation} |`;
    }).join('\n');

    const summary = findings.length === 0
      ? '## ✅ Infrawise — no issues found\n'
      : [
        '## Infrawise Analysis',
        '',
        `**${high} high · ${medium} medium · ${low} low**`,
        '',
        '| Severity | Issue | Recommendation |',
        '|---|---|---|',
        rows,
      ].join('\n');

    fs.appendFileSync(summaryPath, summary + '\n');
  }

  const threshold = SEVERITY_RANK[failOn] ?? 3;
  const maxFound = Math.max(0, ...findings.map((f) => SEVERITY_RANK[f.severity] ?? 0));
  if (maxFound >= threshold && threshold > 0) {
    process.exit(1);
  }
}

export async function runAnalyze(options: AnalyzeOptions = {}): Promise<void> {
  const ci = options.ci ?? false;
  const failOn = options.failOn ?? 'high';

  if (!ci) printHeader('Running Analysis');

  let config;
  let isFallback = false;
  try {
    config = loadConfig(options.config);
    if (!ci) log.success('Config loaded', options.config ?? 'infrawise.yaml');
  } catch (err) {
    const isNotFound = err instanceof Error && err.message.includes('not found at');
    if (ci && isNotFound) {
      config = { project: path.basename(process.cwd()) } as InfrawiseConfig;
      isFallback = true;
      console.log('  ✓ No infrawise.yaml — running code-only analysis (repo scan + IaC)');
    } else {
      console.error(formatError(err));
      process.exit(1);
    }
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
    const s = mkSpinner('Extracting DynamoDB tables...', ci);
    try {
      const result = await extractDynamoMetadata(config);
      dynamoMeta.push(...result);
      s.succeed(chalk.green('DynamoDB') + chalk.dim(`  ${result.length} table(s)`));
    } catch (err) {
      s.warn(chalk.yellow('DynamoDB skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── PostgreSQL ──────────────────────────────────────────────────────────────
  if (config.postgres?.enabled && config.postgres.connectionString) {
    const s = mkSpinner('Extracting PostgreSQL schema...', ci);
    try {
      const result = await extractPostgresMetadata(config.postgres.connectionString);
      postgresMeta.push(...result);
      s.succeed(chalk.green('PostgreSQL') + chalk.dim(`  ${result.length} table(s)`));
    } catch (err) {
      s.warn(chalk.yellow('PostgreSQL skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── MySQL ───────────────────────────────────────────────────────────────────
  if (config.mysql?.enabled && config.mysql.connectionString) {
    const s = mkSpinner('Extracting MySQL schema...', ci);
    try {
      const result = await extractMySQLMetadata(config.mysql.connectionString);
      mysqlMeta.push(...result);
      s.succeed(chalk.green('MySQL') + chalk.dim(`  ${result.length} table(s)`));
    } catch (err) {
      s.warn(chalk.yellow('MySQL skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── MongoDB ─────────────────────────────────────────────────────────────────
  if (config.mongodb?.enabled && config.mongodb.connectionString) {
    const s = mkSpinner('Extracting MongoDB schema...', ci);
    try {
      const result = await extractMongoMetadata(config.mongodb.connectionString, config.mongodb.databases);
      mongoMeta.push(...result);
      s.succeed(chalk.green('MongoDB') + chalk.dim(`  ${result.length} collection(s)`));
    } catch (err) {
      s.warn(chalk.yellow('MongoDB skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── SQS ─────────────────────────────────────────────────────────────────────
  if (config.sqs?.enabled === true) {
    const s = mkSpinner('Extracting SQS queues...', ci);
    try {
      const result = await extractSQSMetadata(awsCfg);
      servicesMeta.sqs = result;
      s.succeed(chalk.green('SQS') + chalk.dim(`  ${result.length} queue(s)`));
    } catch (err) {
      s.warn(chalk.yellow('SQS skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── SNS ─────────────────────────────────────────────────────────────────────
  if (config.sns?.enabled === true) {
    const s = mkSpinner('Extracting SNS topics...', ci);
    try {
      const result = await extractSNSMetadata(awsCfg);
      servicesMeta.sns = result;
      s.succeed(chalk.green('SNS') + chalk.dim(`  ${result.length} topic(s)`));
    } catch (err) {
      s.warn(chalk.yellow('SNS skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── SSM Parameter Store ──────────────────────────────────────────────────────
  if (config.ssm?.enabled === true) {
    const s = mkSpinner('Extracting SSM parameters...', ci);
    try {
      const result = await extractSSMMetadata({ ...awsCfg, paths: config.ssm?.paths });
      servicesMeta.ssm = result;
      s.succeed(chalk.green('SSM') + chalk.dim(`  ${result.length} parameter(s)  `) + chalk.dim('(metadata only, no values)'));
    } catch (err) {
      s.warn(chalk.yellow('SSM skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── Secrets Manager ──────────────────────────────────────────────────────────
  if (config.secretsManager?.enabled === true) {
    const s = mkSpinner('Extracting Secrets Manager metadata...', ci);
    try {
      const result = await extractSecretsMetadata(awsCfg);
      servicesMeta.secrets = result;
      s.succeed(chalk.green('Secrets Manager') + chalk.dim(`  ${result.length} secret(s)  `) + chalk.dim('(names/rotation only, no values)'));
    } catch (err) {
      s.warn(chalk.yellow('Secrets Manager skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── Lambda ───────────────────────────────────────────────────────────────────
  if (config.lambda?.enabled === true) {
    const s = mkSpinner('Extracting Lambda functions...', ci);
    try {
      const result = await extractLambdaMetadata(awsCfg);
      servicesMeta.lambda = result;
      s.succeed(chalk.green('Lambda') + chalk.dim(`  ${result.length} function(s)`));
    } catch (err) {
      s.warn(chalk.yellow('Lambda skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── RDS ──────────────────────────────────────────────────────────────────────
  if (config.rds?.enabled === true) {
    const s = mkSpinner('Extracting RDS instances...', ci);
    try {
      const result = await extractRDSMetadata(awsCfg);
      servicesMeta.rds = result;
      s.succeed(chalk.green('RDS') + chalk.dim(`  ${result.length} instance(s)`));
    } catch (err) {
      s.warn(chalk.yellow('RDS skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── CloudWatch Logs ──────────────────────────────────────────────────────────
  if (config.cloudwatchLogs?.enabled) {
    const s = mkSpinner('Sampling CloudWatch Logs (errors only, max 50 groups)...', ci);
    try {
      const result = await extractLogsMetadata({
        ...awsCfg,
        logGroupPrefixes: config.cloudwatchLogs.logGroupPrefixes,
        windowHours: config.cloudwatchLogs.windowHours,
      });
      servicesMeta.logs = result;
      const errorGroups = result.filter((lg) => lg.errorCount > 0).length;
      s.succeed(chalk.green('CloudWatch Logs') + chalk.dim(`  ${result.length} group(s), ${errorGroups} with errors`));
    } catch (err) {
      s.warn(chalk.yellow('CloudWatch Logs skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── IaC schema (Terraform / CloudFormation / CDK) ────────────────────────────
  let iacDriftAnalyzer: IaCDriftAnalyzer | undefined;
  {
    const s = mkSpinner('Extracting IaC schema (Terraform / CloudFormation / CDK)...', ci);
    try {
      const iacSchema = await extractIaCSchema(repoPath);
      const total = iacSchema.dynamoTables.length + iacSchema.rdsInstances.length +
        iacSchema.mongoClusters.length + iacSchema.queues.length + iacSchema.topics.length +
        iacSchema.lambdas.length + iacSchema.buckets.length + iacSchema.parameters.length +
        iacSchema.secrets.length + iacSchema.apiGateways.length;
      iacDriftAnalyzer = new IaCDriftAnalyzer();
      iacDriftAnalyzer.setIaCSchema(iacSchema);
      s.succeed(chalk.green('IaC schema') + chalk.dim(`  ${total} resource(s) across TF/CFN/CDK`));
    } catch (err) {
      s.warn(chalk.yellow('IaC scan skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // ── Repository scan ──────────────────────────────────────────────────────────
  let operations: ExtractedOperation[];
  {
    const s = mkSpinner(`Scanning ${path.basename(repoPath)} for service usage...`, ci);
    try {
      operations = await scanRepository(repoPath);
      s.succeed(chalk.green('Repository scanned') + chalk.dim(`  ${operations.length} service operation(s) found`));
    } catch (err) {
      s.warn(chalk.yellow('Repository scan failed') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
      operations = [];
    }
  }

  // ── Build graph ──────────────────────────────────────────────────────────────
  let graph: ReturnType<typeof buildGraph>;
  {
    const s = mkSpinner('Building infrastructure graph...', ci);
    graph = buildGraph(operations, dynamoMeta, postgresMeta, mysqlMeta, mongoMeta, servicesMeta);
    s.succeed(chalk.green('Graph built') + chalk.dim(`  ${graph.nodes.length} nodes, ${graph.edges.length} edges`));
  }

  // ── Run analyzers ────────────────────────────────────────────────────────────
  let findings: Awaited<ReturnType<typeof runAllAnalyzers>>;
  {
    const s = mkSpinner('Running analyzers...', ci);
    const analyzers = [
      ...(config.dynamodb?.enabled === true || isFallback ? [
        new FullTableScanAnalyzer(),
        new MissingGSIAnalyzer(),
        new HotPartitionAnalyzer(),
      ] : []),
      ...(config.postgres?.enabled || isFallback ? [
        new MissingIndexAnalyzer(),
        new NplusOneAnalyzer(),
        new LargeSelectAnalyzer(),
      ] : []),
      ...(config.mysql?.enabled || isFallback ? [
        new MissingMySQLIndexAnalyzer(),
        new MySQLFullTableScanAnalyzer(),
      ] : []),
      ...(config.mongodb?.enabled || isFallback ? [
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
    s.succeed(chalk.green('Analysis complete') + chalk.dim(`  ${findings.length} finding(s)`));
  }

  // ── Cache ─────────────────────────────────────────────────────────────────────
  writeCache('graph', graph);
  writeCache('findings', findings);
  writeCache('operations', operations);

  // ── Output ────────────────────────────────────────────────────────────────────
  if (ci) {
    emitCIOutput(findings, failOn);
    return;
  }

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
