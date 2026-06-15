import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { generateDefaultConfig } from '../../core/index.js';
import { readAWSProfiles, detectAWSRegion, log, printHeader } from '../utils.js';

export async function runInit(options: { force?: boolean; quiet?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'infrawise.yaml');

  if (fs.existsSync(configPath) && !options.force) {
    console.log(
      `\n  ${chalk.yellow('⚠')} ${chalk.yellow('infrawise.yaml already exists.')}  ${chalk.dim('Use --force to overwrite.')}\n`,
    );
    return;
  }

  printHeader('Initialize Infrawise');

  const repoName = path.basename(cwd);
  const profiles = readAWSProfiles();
  const detectedRegion = detectAWSRegion();

  log.success(`Repository detected`, repoName);
  log.success(`AWS profiles found`, String(profiles.length));
  console.log('');

  // ── Core settings ──────────────────────────────────────────────────────────
  const { project } = await inquirer.prompt([
    {
      type: 'input',
      name: 'project',
      message: 'Project name:',
      default: repoName,
    },
  ]);

  // ── Step 1: provider ───────────────────────────────────────────────────────
  const { provider } = await inquirer.prompt([
    {
      type: 'select',
      name: 'provider',
      message: 'Infrastructure:',
      choices: [
        { name: 'AWS', value: 'aws' },
        { name: 'Local  (no cloud — databases, queues, self-hosted services)', value: 'local' },
      ],
    },
  ]);

  // ── Step 2: AWS profile (aws only) ────────────────────────────────────────
  let awsProfile = '__env__';
  if (provider === 'aws') {
    const answer = await inquirer.prompt([
      {
        type: 'select',
        name: 'awsProfile',
        message: 'AWS profile:',
        choices: [
          { name: 'Environment variables  (CI/CD)', value: '__env__' },
          ...(profiles.length ? [new inquirer.Separator('── named profiles ──'), ...profiles] : []),
        ],
        default: profiles[0] ?? '__env__',
      },
    ]);
    awsProfile = answer.awsProfile;
  }

  // ── Step 3: region ────────────────────────────────────────────────────────
  let region = detectedRegion;
  if (provider !== 'local') {
    const regionAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'region',
        message: 'AWS region:',
        default: detectedRegion,
      },
    ]);
    region = regionAnswer.region;
  }

  const core = { project, awsProfile, region };

  // ── Databases ──────────────────────────────────────────────────────────────
  console.log('\n  ' + chalk.bold('Databases'));
  console.log(chalk.dim('  Self-hosted databases (PostgreSQL, MySQL, MongoDB).'));
  const databases = await inquirer.prompt([
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

  // ── AWS services (skipped for local) ─────────────────────────────────────
  let services: {
    dynamoEnabled: boolean;
    dynamoTables: string;
    sqsEnabled: boolean;
    snsEnabled: boolean;
    ssmEnabled: boolean;
    ssmPaths: string;
    secretsEnabled: boolean;
    lambdaEnabled: boolean;
    eventbridgeEnabled: boolean;
    rdsEnabled: boolean;
    logsEnabled: boolean;
    logGroupPrefixes: string;
  };

  if (provider === 'local') {
    services = {
      dynamoEnabled: false,
      dynamoTables: '',
      sqsEnabled: false,
      snsEnabled: false,
      ssmEnabled: false,
      ssmPaths: '',
      secretsEnabled: false,
      lambdaEnabled: false,
      eventbridgeEnabled: false,
      rdsEnabled: false,
      logsEnabled: false,
      logGroupPrefixes: '',
    };
  } else {
    console.log('\n  ' + chalk.bold('AWS Services'));
    console.log(
      chalk.dim(
        '  Infrawise will introspect these services using the credentials configured above.',
      ),
    );
    services = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'dynamoEnabled',
        message: 'Introspect DynamoDB?',
        default: true,
      },
      {
        type: 'input',
        name: 'dynamoTables',
        message: 'DynamoDB tables to include:',
        default: '',
        suffix: chalk.dim(' (comma-separated, blank = all)'),
        when: (a) => a.dynamoEnabled,
      },
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
        name: 'eventbridgeEnabled',
        message: 'Introspect EventBridge rules?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'rdsEnabled',
        message: 'Introspect RDS instances?',
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
  } // end else (provider !== 'local')

  // ── Build config ───────────────────────────────────────────────────────────
  const includeTables = services.dynamoTables
    ? services.dynamoTables
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean)
    : [];

  const ssmPaths = services.ssmPaths
    ? services.ssmPaths
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean)
    : [];

  const logGroupPrefixes = services.logGroupPrefixes
    ? services.logGroupPrefixes
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean)
    : [];

  const isEnvVars = core.awsProfile === '__env__';
  const resolvedProfile = isEnvVars ? '' : core.awsProfile;

  const configContent = generateDefaultConfig(core.project, {
    aws: {
      profile: resolvedProfile,
      region: core.region ?? detectedRegion,
    },
    dynamodb: { enabled: services.dynamoEnabled, includeTables },
    postgres: {
      enabled: databases.pgEnabled,
      connectionString: databases.pgConnectionString ?? '',
    },
    mysql: {
      enabled: databases.mysqlEnabled,
      connectionString: databases.mysqlConnectionString ?? '',
    },
    mongodb: {
      enabled: databases.mongoEnabled,
      connectionString: databases.mongoConnectionString ?? '',
    },
    sqs: { enabled: services.sqsEnabled },
    sns: { enabled: services.snsEnabled },
    ssm: { enabled: services.ssmEnabled, paths: ssmPaths },
    secretsManager: { enabled: services.secretsEnabled },
    lambda: { enabled: services.lambdaEnabled },
    eventbridge: { enabled: services.eventbridgeEnabled },
    rds: { enabled: services.rdsEnabled },
    cloudwatchLogs: {
      enabled: services.logsEnabled,
      logGroupPrefixes,
      windowHours: 24,
    },
  });

  fs.writeFileSync(configPath, configContent, 'utf-8');

  console.log('');
  log.success(`Created ${chalk.bold('infrawise.yaml')}`);

  if (!options.quiet) {
    console.log('');
    console.log(chalk.bold('  Next steps:'));
    log.info(`Run ${chalk.cyan('infrawise start')} to analyze and connect your editor`);
    log.info(`Run ${chalk.cyan('infrawise doctor')} to validate your setup`);
    console.log('');
  }
}
