import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { generateDefaultConfig } from '@infrawise/core';
import { readAWSProfiles, detectAWSRegion, detectRepoType, log, printHeader } from '../utils';

export async function runInit(options: { force?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'infrawise.yaml');

  if (fs.existsSync(configPath) && !options.force) {
    console.log(`\n  ${chalk.yellow('⚠')} ${chalk.yellow('infrawise.yaml already exists.')}  ${chalk.dim('Use --force to overwrite.')}\n`);
    return;
  }

  printHeader('Initialize Infrawise');

  const repoType = detectRepoType(cwd);
  const repoName = path.basename(cwd);
  const profiles = readAWSProfiles();
  const detectedRegion = detectAWSRegion();

  log.success(`Repository detected`, repoName);
  log.success(`Type`, repoType);
  log.success(`AWS profiles found`, String(profiles.length));
  console.log('');

  // ── Core settings ──────────────────────────────────────────────────────────
  const core = await inquirer.prompt([
    {
      type: 'input',
      name: 'project',
      message: 'Project name:',
      default: repoName,
    },
    {
      type: 'list',
      name: 'awsProfile',
      message: 'AWS profile:',
      choices: profiles,
      default: profiles[0],
    },
    {
      type: 'input',
      name: 'region',
      message: 'AWS region:',
      default: detectedRegion,
    },
  ]);

  // ── Databases ──────────────────────────────────────────────────────────────
  console.log('\n  ' + chalk.bold('Databases'));
  const databases = await inquirer.prompt([
    {
      type: 'input',
      name: 'dynamoTables',
      message: 'DynamoDB tables to include:',
      default: '',
      suffix: chalk.dim(' (comma-separated, blank = all)'),
    },
    {
      type: 'confirm',
      name: 'pgEnabled',
      message: 'Enable PostgreSQL analysis?',
      default: false,
    },
    {
      type: 'input',
      name: 'pgConnectionString',
      message: 'PostgreSQL connection string:',
      default: 'postgresql://localhost:5432/mydb',
      when: (a) => a.pgEnabled,
    },
    {
      type: 'confirm',
      name: 'mysqlEnabled',
      message: 'Enable MySQL analysis?',
      default: false,
    },
    {
      type: 'input',
      name: 'mysqlConnectionString',
      message: 'MySQL connection string:',
      default: 'mysql://localhost:3306/mydb',
      when: (a) => a.mysqlEnabled,
    },
    {
      type: 'confirm',
      name: 'mongoEnabled',
      message: 'Enable MongoDB analysis?',
      default: false,
    },
    {
      type: 'input',
      name: 'mongoConnectionString',
      message: 'MongoDB connection string:',
      default: 'mongodb://localhost:27017',
      when: (a) => a.mongoEnabled,
    },
  ]);

  // ── AWS services ───────────────────────────────────────────────────────────
  console.log('\n  ' + chalk.bold('AWS Services'));
  console.log(chalk.dim('  Infrawise will introspect these services — credentials from the AWS profile above.'));
  const services = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'sqsEnabled',
      message: 'Introspect SQS queues?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'snsEnabled',
      message: 'Introspect SNS topics?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'ssmEnabled',
      message: 'Introspect SSM Parameter Store? (metadata only, no values)',
      default: true,
    },
    {
      type: 'input',
      name: 'ssmPaths',
      message: 'SSM path prefixes to filter:',
      default: '',
      suffix: chalk.dim(' (comma-separated, blank = all  e.g. /myapp/prod)'),
      when: (a) => a.ssmEnabled,
    },
    {
      type: 'confirm',
      name: 'secretsEnabled',
      message: 'Introspect Secrets Manager? (names & rotation only, no values)',
      default: true,
    },
    {
      type: 'confirm',
      name: 'lambdaEnabled',
      message: 'Introspect Lambda functions?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'logsEnabled',
      message: 'Sample CloudWatch Logs? (error patterns only, no raw logs)',
      default: false,
    },
    {
      type: 'input',
      name: 'logGroupPrefixes',
      message: 'CloudWatch log group prefixes:',
      default: '',
      suffix: chalk.dim(' (comma-separated, blank = all)'),
      when: (a) => a.logsEnabled,
    },
  ]);

  // ── Build config ───────────────────────────────────────────────────────────
  const includeTables = databases.dynamoTables
    ? databases.dynamoTables.split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];

  const ssmPaths = services.ssmPaths
    ? services.ssmPaths.split(',').map((p: string) => p.trim()).filter(Boolean)
    : [];

  const logGroupPrefixes = services.logGroupPrefixes
    ? services.logGroupPrefixes.split(',').map((p: string) => p.trim()).filter(Boolean)
    : [];

  const configContent = generateDefaultConfig(core.project, {
    aws: { profile: core.awsProfile, region: core.region },
    dynamodb: { includeTables },
    postgres: { enabled: databases.pgEnabled, connectionString: databases.pgConnectionString ?? '' },
    mysql: { enabled: databases.mysqlEnabled, connectionString: databases.mysqlConnectionString ?? '' },
    mongodb: { enabled: databases.mongoEnabled, connectionString: databases.mongoConnectionString ?? '' },
    sqs: { enabled: services.sqsEnabled },
    sns: { enabled: services.snsEnabled },
    ssm: { enabled: services.ssmEnabled, paths: ssmPaths },
    secretsManager: { enabled: services.secretsEnabled },
    lambda: { enabled: services.lambdaEnabled },
    cloudwatchLogs: {
      enabled: services.logsEnabled,
      logGroupPrefixes,
      windowHours: 24,
    },
  });

  fs.writeFileSync(configPath, configContent, 'utf-8');

  console.log('');
  log.success(`Created ${chalk.bold('infrawise.yaml')}`);
  console.log('');
  console.log(chalk.bold('  Next steps:'));
  log.info(`Run ${chalk.cyan('infrawise doctor')} to validate your setup`);
  log.info(`Run ${chalk.cyan('infrawise analyze')} to scan your infrastructure`);
  log.info(`Run ${chalk.cyan('infrawise dev')} to start the MCP server`);
  console.log('');
}
