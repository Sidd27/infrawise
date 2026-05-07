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

  const answers = await inquirer.prompt([
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
    {
      type: 'input',
      name: 'dynamoTables',
      message: 'DynamoDB tables to include:',
      default: '',
      suffix: chalk.dim(' (comma-separated, leave blank for all)'),
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

  const includeTables = answers.dynamoTables
    ? answers.dynamoTables.split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];

  const configContent = generateDefaultConfig(answers.project, {
    aws: { profile: answers.awsProfile, region: answers.region },
    dynamodb: { includeTables },
    postgres: {
      enabled: answers.pgEnabled,
      connectionString: answers.pgConnectionString ?? '',
    },
    mysql: {
      enabled: answers.mysqlEnabled,
      connectionString: answers.mysqlConnectionString ?? '',
    },
    mongodb: {
      enabled: answers.mongoEnabled,
      connectionString: answers.mongoConnectionString ?? '',
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
