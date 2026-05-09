import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../core';
import { probeDynamoAccess } from '../../adapters/dynamodb';
import { validatePostgresAccess } from '../../adapters/postgres';
import { validateMySQLAccess } from '../../adapters/mysql';
import { validateMongoAccess } from '../../adapters/mongodb';
import {
  validateSQSAccess,
  validateSNSAccess,
  validateSSMAccess,
  validateSecretsAccess,
  validateLambdaAccess,
} from '../../adapters/aws';
import { validateLogsAccess } from '../../adapters/logs';
import { printHeader } from '../utils';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  detail?: string;
}

async function runCheck(label: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  const spin = ora({ text: chalk.dim(label), color: 'cyan' }).start();
  const result = await fn();
  switch (result.status) {
    case 'pass': spin.succeed(chalk.green(result.name) + chalk.dim(`  ${result.message}`)); break;
    case 'fail': spin.fail(chalk.red(result.name) + chalk.dim(`  ${result.message}`)); break;
    case 'warn': spin.warn(chalk.yellow(result.name) + chalk.dim(`  ${result.message}`)); break;
    case 'skip': spin.info(chalk.dim(`${result.name}  ${result.message}`)); break;
  }
  if (result.detail) console.log(chalk.dim(`       ${result.detail}`));
  return result;
}

export async function runDoctor(options: { config?: string } = {}): Promise<void> {
  printHeader('Infrawise Doctor');

  const configPath = path.resolve(options.config ?? 'infrawise.yaml');
  const results: CheckResult[] = [];

  // Config file
  results.push(await runCheck('Checking config file...', async () => {
    const exists = fs.existsSync(configPath);
    return {
      name: 'Config file',
      status: exists ? 'pass' : 'fail',
      message: exists ? configPath : `Not found at ${configPath}`,
      detail: exists ? undefined : 'Run: infrawise init',
    };
  }));

  // Config valid
  let config: ReturnType<typeof loadConfig> | undefined;
  results.push(await runCheck('Validating config...', async () => {
    if (!fs.existsSync(configPath)) return { name: 'Config validation', status: 'skip', message: 'No config file' };
    try {
      config = loadConfig(options.config);
      return { name: 'Config validation', status: 'pass', message: `project: ${config.project}` };
    } catch (err) {
      return {
        name: 'Config validation', status: 'fail', message: 'Invalid config',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }));

  // AWS credentials
  results.push(await runCheck('Checking AWS credentials...', async () => {
    const home = process.env.HOME ?? os.homedir();
    const hasCreds = fs.existsSync(path.join(home, '.aws', 'credentials')) ||
                     fs.existsSync(path.join(home, '.aws', 'config'));
    return {
      name: 'AWS credentials',
      status: hasCreds ? 'pass' : 'warn',
      message: hasCreds ? 'Found' : 'Not found — may use env vars or IAM role',
      detail: hasCreds ? undefined : 'Run: aws configure',
    };
  }));

  const awsCfg = { region: config?.aws?.region, profile: config?.aws?.profile, endpoint: config?.aws?.endpoint };

  // DynamoDB
  results.push(await runCheck('Testing DynamoDB access...', async () => {
    if (!config) return { name: 'DynamoDB', status: 'skip', message: 'No valid config' };
    if (config.dynamodb?.enabled !== true) return { name: 'DynamoDB', status: 'skip', message: 'Disabled in config' };
    try {
      await probeDynamoAccess(config);
      return { name: 'DynamoDB', status: 'pass', message: `Connected (profile: ${config.aws?.profile ?? 'default'})` };
    } catch (err) {
      return {
        name: 'DynamoDB', status: 'warn',
        message: err instanceof Error ? err.message : String(err),
        detail: 'Check IAM: dynamodb:ListTables, dynamodb:DescribeTable',
      };
    }
  }));

  // SQS
  results.push(await runCheck('Testing SQS access...', async () => {
    if (config?.sqs?.enabled !== true) return { name: 'SQS', status: 'skip', message: 'Disabled in config' };
    try {
      await validateSQSAccess(awsCfg);
      return { name: 'SQS', status: 'pass', message: 'Connected' };
    } catch (err) {
      return {
        name: 'SQS', status: 'warn',
        message: err instanceof Error ? err.message : String(err),
        detail: 'Check IAM: sqs:ListQueues, sqs:GetQueueAttributes',
      };
    }
  }));

  // SNS
  results.push(await runCheck('Testing SNS access...', async () => {
    if (config?.sns?.enabled !== true) return { name: 'SNS', status: 'skip', message: 'Disabled in config' };
    try {
      await validateSNSAccess(awsCfg);
      return { name: 'SNS', status: 'pass', message: 'Connected' };
    } catch (err) {
      return {
        name: 'SNS', status: 'warn',
        message: err instanceof Error ? err.message : String(err),
        detail: 'Check IAM: sns:ListTopics, sns:GetTopicAttributes, sns:ListSubscriptionsByTopic',
      };
    }
  }));

  // SSM
  results.push(await runCheck('Testing SSM Parameter Store access...', async () => {
    if (config?.ssm?.enabled !== true) return { name: 'SSM', status: 'skip', message: 'Disabled in config' };
    try {
      await validateSSMAccess(awsCfg);
      return { name: 'SSM', status: 'pass', message: 'Connected (metadata only)' };
    } catch (err) {
      return {
        name: 'SSM', status: 'warn',
        message: err instanceof Error ? err.message : String(err),
        detail: 'Check IAM: ssm:DescribeParameters',
      };
    }
  }));

  // Secrets Manager
  results.push(await runCheck('Testing Secrets Manager access...', async () => {
    if (config?.secretsManager?.enabled !== true) return { name: 'Secrets Manager', status: 'skip', message: 'Disabled in config' };
    try {
      await validateSecretsAccess(awsCfg);
      return { name: 'Secrets Manager', status: 'pass', message: 'Connected (names/rotation only)' };
    } catch (err) {
      return {
        name: 'Secrets Manager', status: 'warn',
        message: err instanceof Error ? err.message : String(err),
        detail: 'Check IAM: secretsmanager:ListSecrets',
      };
    }
  }));

  // Lambda
  results.push(await runCheck('Testing Lambda access...', async () => {
    if (config?.lambda?.enabled !== true) return { name: 'Lambda', status: 'skip', message: 'Disabled in config' };
    try {
      await validateLambdaAccess(awsCfg);
      return { name: 'Lambda', status: 'pass', message: 'Connected' };
    } catch (err) {
      return {
        name: 'Lambda', status: 'warn',
        message: err instanceof Error ? err.message : String(err),
        detail: 'Check IAM: lambda:ListFunctions',
      };
    }
  }));

  // CloudWatch Logs
  results.push(await runCheck('Testing CloudWatch Logs access...', async () => {
    if (!config?.cloudwatchLogs?.enabled) return { name: 'CloudWatch Logs', status: 'skip', message: 'Not enabled in config' };
    try {
      await validateLogsAccess(awsCfg);
      return { name: 'CloudWatch Logs', status: 'pass', message: 'Connected' };
    } catch (err) {
      return {
        name: 'CloudWatch Logs', status: 'warn',
        message: err instanceof Error ? err.message : String(err),
        detail: 'Check IAM: logs:DescribeLogGroups, logs:FilterLogEvents',
      };
    }
  }));

  // PostgreSQL
  results.push(await runCheck('Testing PostgreSQL...', async () => {
    if (!config?.postgres?.enabled || !config.postgres.connectionString) {
      return { name: 'PostgreSQL', status: 'skip', message: 'Not configured' };
    }
    try {
      const ok = await validatePostgresAccess(config.postgres.connectionString);
      return {
        name: 'PostgreSQL', status: ok ? 'pass' : 'fail',
        message: ok ? 'Connected' : 'Cannot connect',
        detail: ok ? undefined : 'Check connection string and security group',
      };
    } catch (err) {
      return { name: 'PostgreSQL', status: 'fail', message: err instanceof Error ? err.message : String(err) };
    }
  }));

  // MySQL
  results.push(await runCheck('Testing MySQL...', async () => {
    if (!config?.mysql?.enabled || !config.mysql.connectionString) {
      return { name: 'MySQL', status: 'skip', message: 'Not configured' };
    }
    try {
      const ok = await validateMySQLAccess(config.mysql.connectionString);
      return {
        name: 'MySQL', status: ok ? 'pass' : 'fail',
        message: ok ? 'Connected' : 'Cannot connect',
        detail: ok ? undefined : 'Check connection string, host, port 3306',
      };
    } catch (err) {
      return { name: 'MySQL', status: 'fail', message: err instanceof Error ? err.message : String(err) };
    }
  }));

  // MongoDB
  results.push(await runCheck('Testing MongoDB...', async () => {
    if (!config?.mongodb?.enabled || !config.mongodb.connectionString) {
      return { name: 'MongoDB', status: 'skip', message: 'Not configured' };
    }
    try {
      const ok = await validateMongoAccess(config.mongodb.connectionString);
      return {
        name: 'MongoDB', status: ok ? 'pass' : 'fail',
        message: ok ? 'Connected' : 'Cannot connect',
        detail: ok ? undefined : 'Check connection string and port 27017',
      };
    } catch (err) {
      return { name: 'MongoDB', status: 'fail', message: err instanceof Error ? err.message : String(err) };
    }
  }));

  // Project type
  results.push(await runCheck('Detecting project type...', async () => {
    const hasTsConfig = fs.existsSync(path.join(process.cwd(), 'tsconfig.json'));
    const hasPkg = fs.existsSync(path.join(process.cwd(), 'package.json'));
    return {
      name: 'Project type',
      status: hasTsConfig ? 'pass' : 'warn',
      message: hasTsConfig ? 'TypeScript' : hasPkg ? 'JavaScript (no tsconfig.json)' : 'Unknown',
      detail: hasTsConfig ? undefined : 'Scanner works best with TypeScript projects',
    };
  }));

  // IaC detection
  results.push(await runCheck('Detecting IaC files...', async () => {
    const cwd = process.cwd();
    const hasTfFile = (dir: string) => fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.tf'));
    const hasTF = hasTfFile(cwd) || fs.readdirSync(cwd).some((entry) => {
      const full = path.join(cwd, entry);
      return fs.statSync(full).isDirectory() && hasTfFile(full);
    });
    const hasCFN = fs.existsSync(path.join(cwd, 'template.yaml')) || fs.existsSync(path.join(cwd, 'template.json'));
    const hasCDK = fs.existsSync(path.join(cwd, 'cdk.json'));
    const hasCDKOut = fs.existsSync(path.join(cwd, 'cdk.out'));

    const found: string[] = [];
    if (hasTF) found.push('Terraform');
    if (hasCFN) found.push('CloudFormation');
    if (hasCDK) found.push(`CDK${hasCDKOut ? ' (synthesized)' : ' (run cdk synth)'}`);

    return {
      name: 'IaC files',
      status: found.length > 0 ? 'pass' : 'warn',
      message: found.length > 0 ? found.join(', ') : 'No Terraform/CFN/CDK files detected',
      detail: found.length === 0 ? 'IaC analysis will be skipped without TF/CFN/CDK files' : undefined,
    };
  }));

  // Cache
  results.push(await runCheck('Checking analysis cache...', async () => {
    const cached = fs.existsSync(path.join(process.cwd(), '.infrawise', 'cache', 'graph.json'));
    return {
      name: 'Analysis cache',
      status: cached ? 'pass' : 'warn',
      message: cached ? 'Cached results found' : 'No cache — run infrawise analyze first',
    };
  }));

  // Summary
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;

  console.log('');
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  if (failed === 0) {
    console.log(`  ${chalk.green.bold('All checks passed')}  ${chalk.dim(`${passed} passed, ${warned} warning(s)`)}`);
  } else {
    console.log(`  ${chalk.red.bold(`${failed} check(s) failed`)}  ${chalk.dim(`${passed} passed, ${warned} warning(s)`)}`);
  }
  console.log('');
  if (failed > 0) process.exit(1);
}
