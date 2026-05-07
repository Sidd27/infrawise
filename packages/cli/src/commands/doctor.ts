import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '@infrawise/core';
import { validateDynamoAccess } from '@infrawise/adapters-dynamodb';
import { validatePostgresAccess } from '@infrawise/adapters-postgres';
import { validateMySQLAccess } from '@infrawise/adapters-mysql';
import { validateMongoAccess } from '@infrawise/adapters-mongodb';
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
  if (result.detail) {
    console.log(chalk.dim(`       ${result.detail}`));
  }
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
    if (!fs.existsSync(configPath)) {
      return { name: 'Config validation', status: 'skip', message: 'No config file' };
    }
    try {
      config = loadConfig(options.config);
      return { name: 'Config validation', status: 'pass', message: `project: ${config.project}` };
    } catch (err) {
      return {
        name: 'Config validation',
        status: 'fail',
        message: 'Invalid config',
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

  // DynamoDB access
  results.push(await runCheck('Testing DynamoDB access...', async () => {
    if (!config) return { name: 'DynamoDB access', status: 'skip', message: 'No valid config' };
    try {
      const ok = await validateDynamoAccess(config);
      return {
        name: 'DynamoDB access',
        status: ok ? 'pass' : 'fail',
        message: ok
          ? `Connected (profile: ${config.aws?.profile ?? 'default'})`
          : 'Cannot connect',
        detail: ok ? undefined : 'Check IAM: dynamodb:ListTables, dynamodb:DescribeTable',
      };
    } catch (err) {
      return {
        name: 'DynamoDB access',
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
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
        name: 'PostgreSQL',
        status: ok ? 'pass' : 'fail',
        message: ok ? 'Connected' : 'Cannot connect',
        detail: ok ? undefined : 'Check connection string, security group, and credentials',
      };
    } catch (err) {
      return {
        name: 'PostgreSQL',
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
      };
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
        name: 'MySQL',
        status: ok ? 'pass' : 'fail',
        message: ok ? 'Connected' : 'Cannot connect',
        detail: ok ? undefined : 'Check connection string, host, port 3306, and credentials',
      };
    } catch (err) {
      return {
        name: 'MySQL',
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
      };
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
        name: 'MongoDB',
        status: ok ? 'pass' : 'fail',
        message: ok ? 'Connected' : 'Cannot connect',
        detail: ok ? undefined : 'Check connection string, host, port 27017, and credentials',
      };
    } catch (err) {
      return {
        name: 'MongoDB',
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }));

  // TypeScript project
  results.push(await runCheck('Detecting project type...', async () => {
    const hasTsConfig = fs.existsSync(path.join(process.cwd(), 'tsconfig.json'));
    const hasPkg = fs.existsSync(path.join(process.cwd(), 'package.json'));
    return {
      name: 'Project type',
      status: hasTsConfig ? 'pass' : 'warn',
      message: hasTsConfig ? 'TypeScript (tsconfig.json found)' : hasPkg ? 'JavaScript (no tsconfig.json)' : 'Unknown project',
      detail: hasTsConfig ? undefined : 'Scanner works best with TypeScript projects',
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

// lazy import os to avoid top-level side-effect
import * as os from 'os';
