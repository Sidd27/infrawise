import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { generateDefaultConfig } from '@infrawise/core';
import { readAWSProfiles, detectAWSRegion, detectRepoType, GREEN, BOLD, RESET, CYAN, YELLOW } from '../utils';

function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const displayDefault = defaultValue ? ` (${defaultValue})` : '';
    rl.question(`${question}${displayDefault}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

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

export async function runInit(options: { force?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'infrawise.yaml');

  if (fs.existsSync(configPath) && !options.force) {
    console.log(`${YELLOW}infrawise.yaml already exists.${RESET} Use --force to overwrite.`);
    return;
  }

  console.log(`${BOLD}Initializing Infrawise configuration...${RESET}\n`);

  // Detect repo info
  const repoType = detectRepoType(cwd);
  const repoName = path.basename(cwd);

  console.log(`${GREEN}✓${RESET} Detected repository: ${BOLD}${repoName}${RESET}`);
  console.log(`${GREEN}✓${RESET} Repository type: ${BOLD}${repoType}${RESET}`);

  // AWS profile selection
  const profiles = readAWSProfiles();
  let selectedProfile: string;

  if (profiles.length === 1) {
    selectedProfile = profiles[0]!;
    console.log(`${GREEN}✓${RESET} AWS profile: ${BOLD}${selectedProfile}${RESET}`);
  } else {
    console.log(`${GREEN}✓${RESET} Found ${profiles.length} AWS profile(s)`);
    selectedProfile = await promptSelect('Select AWS profile:', profiles);
  }

  const detectedRegion = detectAWSRegion();
  const projectName = await prompt(`Project name`, repoName);
  const region = await prompt(`AWS region`, detectedRegion);

  // Ask about DynamoDB tables
  const tablesInput = await prompt(
    `DynamoDB tables to include (comma-separated, leave empty to include all)`,
    '',
  );
  const includeTables = tablesInput
    ? tablesInput.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  // Ask about PostgreSQL
  const pgEnabledInput = await prompt(`Enable PostgreSQL analysis? (yes/no)`, 'no');
  const pgEnabled = pgEnabledInput.toLowerCase().startsWith('y');

  let pgConnectionString = '';
  if (pgEnabled) {
    pgConnectionString = await prompt(
      `PostgreSQL connection string`,
      'postgresql://localhost:5432/mydb',
    );
  }

  // Generate config
  const configContent = generateDefaultConfig(projectName, {
    aws: { profile: selectedProfile, region },
    dynamodb: { includeTables },
    postgres: { enabled: pgEnabled, connectionString: pgConnectionString },
  });

  fs.writeFileSync(configPath, configContent, 'utf-8');

  console.log(`\n${GREEN}✓${RESET} Created ${BOLD}infrawise.yaml${RESET}`);
  console.log(`\n${BOLD}Next steps:${RESET}`);
  console.log(`  1. Review the generated configuration file`);
  console.log(`  2. Run ${CYAN}infrawise analyze${RESET} to analyze your infrastructure`);
  console.log(`  3. Run ${CYAN}infrawise dev${RESET} to start the MCP server`);
}
