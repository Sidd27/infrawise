import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '@infrawise/core';
import { validateDynamoAccess } from '@infrawise/adapters-dynamodb';
import { validatePostgresAccess } from '@infrawise/adapters-postgres';
import { GREEN, RED, YELLOW, BOLD, RESET, DIM, CYAN } from '../utils';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  detail?: string;
}

function printCheck(result: CheckResult): void {
  const icon =
    result.status === 'pass'
      ? `${GREEN}✓${RESET}`
      : result.status === 'fail'
        ? `${RED}✗${RESET}`
        : result.status === 'warn'
          ? `${YELLOW}⚠${RESET}`
          : `${DIM}−${RESET}`;

  const color =
    result.status === 'pass'
      ? GREEN
      : result.status === 'fail'
        ? RED
        : result.status === 'warn'
          ? YELLOW
          : DIM;

  console.log(`  ${icon} ${color}${result.name}${RESET}: ${result.message}`);
  if (result.detail) {
    console.log(`    ${DIM}${result.detail}${RESET}`);
  }
}

export async function runDoctor(options: { config?: string } = {}): Promise<void> {
  console.log(`${BOLD}Infrawise Doctor${RESET}\n`);
  console.log('Running diagnostic checks...\n');

  const results: CheckResult[] = [];

  // Check 1: Config file
  const configPath = path.resolve(options.config ?? 'infrawise.yaml');
  const configExists = fs.existsSync(configPath);
  results.push({
    name: 'Configuration file',
    status: configExists ? 'pass' : 'fail',
    message: configExists ? `Found at ${configPath}` : `Not found at ${configPath}`,
    detail: configExists ? undefined : 'Run: infrawise init',
  });

  let config;
  if (configExists) {
    try {
      config = loadConfig(options.config);
      results.push({
        name: 'Configuration validation',
        status: 'pass',
        message: `Valid (project: ${config.project})`,
      });
    } catch (err) {
      results.push({
        name: 'Configuration validation',
        status: 'fail',
        message: 'Invalid configuration',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    results.push({
      name: 'Configuration validation',
      status: 'skip',
      message: 'Skipped (no config file)',
    });
  }

  // Check 2: AWS credentials
  const awsCredsPath = path.join(process.env.HOME ?? '~', '.aws', 'credentials');
  const awsConfigPath = path.join(process.env.HOME ?? '~', '.aws', 'config');
  const hasAwsCreds = fs.existsSync(awsCredsPath) || fs.existsSync(awsConfigPath);

  results.push({
    name: 'AWS credentials file',
    status: hasAwsCreds ? 'pass' : 'warn',
    message: hasAwsCreds ? 'Found' : 'Not found — using environment variables or IAM role',
    detail: hasAwsCreds ? undefined : 'Run: aws configure to set up credentials',
  });

  // Check 3: DynamoDB access
  if (config) {
    try {
      const canAccess = await validateDynamoAccess(config);
      results.push({
        name: 'DynamoDB access',
        status: canAccess ? 'pass' : 'fail',
        message: canAccess
          ? `Access confirmed (profile: ${config.aws?.profile ?? 'default'})`
          : 'Cannot access DynamoDB',
        detail: canAccess
          ? undefined
          : 'Check IAM permissions: dynamodb:ListTables, dynamodb:DescribeTable',
      });
    } catch (err) {
      results.push({
        name: 'DynamoDB access',
        status: 'fail',
        message: 'Connection error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    results.push({
      name: 'DynamoDB access',
      status: 'skip',
      message: 'Skipped (no valid config)',
    });
  }

  // Check 4: PostgreSQL connectivity
  if (config?.postgres?.enabled && config.postgres.connectionString) {
    try {
      const canConnect = await validatePostgresAccess(config.postgres.connectionString);
      results.push({
        name: 'PostgreSQL connectivity',
        status: canConnect ? 'pass' : 'fail',
        message: canConnect ? 'Connection successful' : 'Cannot connect to PostgreSQL',
        detail: canConnect ? undefined : 'Check connection string, network access, and credentials',
      });
    } catch (err) {
      results.push({
        name: 'PostgreSQL connectivity',
        status: 'fail',
        message: 'Connection error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    results.push({
      name: 'PostgreSQL connectivity',
      status: 'skip',
      message: config?.postgres?.enabled === false ? 'Disabled in config' : 'Not configured',
    });
  }

  // Check 5: TypeScript project detection
  const hasTsConfig = fs.existsSync(path.join(process.cwd(), 'tsconfig.json'));
  const hasPackageJson = fs.existsSync(path.join(process.cwd(), 'package.json'));

  results.push({
    name: 'TypeScript project',
    status: hasTsConfig ? 'pass' : hasPackageJson ? 'warn' : 'warn',
    message: hasTsConfig
      ? 'tsconfig.json found'
      : hasPackageJson
        ? 'package.json found but no tsconfig.json'
        : 'No package.json or tsconfig.json found',
    detail: hasTsConfig
      ? undefined
      : 'Scanner works best with TypeScript projects (tsconfig.json)',
  });

  // Check 6: Cache directory
  const cacheDir = path.join(process.cwd(), '.infrawise', 'cache');
  const hasCached = fs.existsSync(path.join(cacheDir, 'graph.json'));

  results.push({
    name: 'Analysis cache',
    status: hasCached ? 'pass' : 'warn',
    message: hasCached ? `Cached results found` : 'No cached results',
    detail: hasCached ? undefined : `Run: ${CYAN}infrawise analyze${RESET} to generate results`,
  });

  // Print all results
  for (const result of results) {
    printCheck(result);
  }

  // Summary
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;

  console.log('\n' + '─'.repeat(50));

  if (failed === 0) {
    console.log(
      `${GREEN}${BOLD}All checks passed${RESET} (${passed} passed, ${warned} warnings)`,
    );
  } else {
    console.log(
      `${RED}${failed} check(s) failed${RESET}, ${passed} passed, ${warned} warnings`,
    );
    process.exit(1);
  }
}
