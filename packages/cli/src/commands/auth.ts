import * as readline from 'readline';
import { readAWSProfiles, GREEN, BOLD, RESET, CYAN, YELLOW, RED } from '../utils';
import { validateDynamoAccess } from '@infrawise/adapters-dynamodb';
import type { InfrawiseConfig } from '@infrawise/shared';

function promptSelect(question: string, options: string[]): Promise<string> {
  console.log(`\n${question}`);
  options.forEach((opt, i) => console.log(`  ${CYAN}${i + 1})${RESET} ${opt}`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`Select (1-${options.length}): `, (answer) => {
      rl.close();
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx]!);
      } else {
        resolve(options[0]!);
      }
    });
  });
}

export async function runAuth(): Promise<void> {
  console.log(`${BOLD}AWS Authentication${RESET}\n`);

  const profiles = readAWSProfiles();

  if (profiles.length === 0) {
    console.log(`${RED}No AWS profiles found.${RESET}`);
    console.log('\nTo configure AWS credentials:');
    console.log('  Run: aws configure');
    console.log('  Or manually edit: ~/.aws/credentials');
    return;
  }

  console.log(`Found ${profiles.length} AWS profile(s):`);

  const selectedProfile = await promptSelect('Select a profile to validate:', profiles);

  console.log(`\nValidating profile "${selectedProfile}"...`);

  // Test DynamoDB access with selected profile
  const testConfig: InfrawiseConfig = {
    project: 'auth-test',
    aws: { profile: selectedProfile, region: 'us-east-1' },
  };

  const isValid = await validateDynamoAccess(testConfig);

  if (isValid) {
    console.log(`\n${GREEN}✓${RESET} Profile "${BOLD}${selectedProfile}${RESET}" is valid and has DynamoDB access.`);
    console.log(`\nUpdate your infrawise.yaml:`);
    console.log(`  ${CYAN}aws:`);
    console.log(`    profile: ${selectedProfile}${RESET}`);
  } else {
    console.log(`\n${YELLOW}⚠${RESET} Profile "${BOLD}${selectedProfile}${RESET}" could not access DynamoDB.`);
    console.log('\nPossible issues:');
    console.log('  - Missing IAM permissions (need dynamodb:ListTables at minimum)');
    console.log('  - Expired credentials — run: aws sso login');
    console.log('  - Wrong region — check your AWS config');
    console.log('\nRun: infrawise doctor for a full diagnostic');
  }
}
