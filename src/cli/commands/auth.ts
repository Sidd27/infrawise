import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { readAWSProfiles, log, printHeader } from '../utils.js';
import { validateDynamoAccess } from '../../adapters/aws/dynamodb.js';
import type { InfrawiseConfig } from '../../types.js';

export async function runAuth(): Promise<void> {
  printHeader('AWS Authentication');

  const profiles = readAWSProfiles();

  if (profiles.length === 0) {
    log.fail('No AWS profiles found');
    console.log('');
    log.info('Run ' + chalk.cyan('aws configure') + ' to set up credentials');
    log.info('Or manually edit ' + chalk.dim('~/.aws/credentials'));
    console.log('');
    return;
  }

  log.success(`Found ${profiles.length} profile(s)`);
  console.log('');

  const { selectedProfile } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedProfile',
      message: 'Select a profile to validate:',
      choices: profiles,
    },
  ]);

  console.log('');
  const spin = ora({
    text: chalk.dim(`Validating "${selectedProfile}"...`),
    color: 'cyan',
  }).start();

  const testConfig: InfrawiseConfig = {
    project: 'auth-test',
    aws: { profile: selectedProfile, region: 'us-east-1' },
  };

  const isValid = await validateDynamoAccess(testConfig);

  if (isValid) {
    spin.succeed(chalk.green(`Profile "${chalk.bold(selectedProfile)}" is valid`));
    console.log('');
    console.log(chalk.dim('  Update your infrawise.yaml:'));
    console.log(chalk.cyan(`  aws:\n    profile: ${selectedProfile}`));
  } else {
    spin.fail(chalk.red(`Profile "${chalk.bold(selectedProfile)}" cannot access DynamoDB`));
    console.log('');
    log.warn('Possible causes:');
    log.dim('Missing IAM permissions — need dynamodb:ListTables, dynamodb:DescribeTable');
    log.dim('Expired SSO — run: aws sso login');
    log.dim('Wrong region — check your AWS config');
    console.log('');
    log.info(`Run ${chalk.cyan('infrawise doctor')} for a full diagnostic`);
  }
  console.log('');
}
