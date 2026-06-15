import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { probePort, scanDotEnv } from '../probe.js';
import { readAWSProfiles, detectAWSRegion, log } from '../utils.js';
import { runInit } from './init.js';

const DB_PORTS = { postgres: 5432, mysql: 3306, mongodb: 27017 } as const;

const ENV_KEYS: Record<keyof typeof DB_PORTS, string[]> = {
  postgres: ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRESQL_URL', 'POSTGRES_CONNECTION_STRING'],
  mysql: ['MYSQL_URL', 'MYSQL_CONNECTION_STRING'],
  mongodb: ['MONGO_URI', 'MONGODB_URI', 'MONGO_URL', 'MONGODB_URL'],
};

export async function runDiscover(options: { interactive?: boolean } = {}): Promise<void> {
  if (options.interactive) {
    await runInit();
    return;
  }

  const cwd = process.cwd();
  log.dim('Probing environment...');

  const [pgDetected, mysqlDetected, mongoDetected] = await Promise.all([
    probePort('localhost', DB_PORTS.postgres, 300),
    probePort('localhost', DB_PORTS.mysql, 300),
    probePort('localhost', DB_PORTS.mongodb, 300),
  ]);

  if (pgDetected) log.success('Postgres detected', `port ${DB_PORTS.postgres}`);
  if (mysqlDetected) log.success('MySQL detected', `port ${DB_PORTS.mysql}`);
  if (mongoDetected) log.success('MongoDB detected', `port ${DB_PORTS.mongodb}`);

  const envVars = scanDotEnv(cwd);
  const secrets = extractDbSecrets(envVars);

  const iacDetected = detectIaC(cwd);

  const hasAWSConfig =
    process.env.AWS_ACCESS_KEY_ID !== undefined ||
    fs.existsSync(path.join(os.homedir(), '.aws', 'credentials')) ||
    fs.existsSync(path.join(os.homedir(), '.aws', 'config'));

  if (!hasAWSConfig && !pgDetected && !mysqlDetected && !mongoDetected) {
    console.error(chalk.red('\n  Nothing detected.'));
    console.error(
      chalk.dim('  Run `aws configure` to set up AWS credentials, or start a local database.\n'),
    );
    process.exit(1);
  }

  let selectedProfile = '';
  if (process.env.AWS_PROFILE) {
    selectedProfile = process.env.AWS_PROFILE;
    log.success('AWS profile', `${selectedProfile} (from AWS_PROFILE)`);
  } else {
    const profiles = readAWSProfiles();
    if (profiles.length === 1) {
      selectedProfile = profiles[0];
      log.success('AWS profile', profiles[0]);
    } else if (profiles.length > 1) {
      console.log('');
      const answer = await inquirer.prompt([
        {
          type: 'select',
          name: 'profile',
          message: 'Select AWS profile:',
          choices: profiles,
          default: profiles[0],
        },
      ]);
      selectedProfile = answer.profile as string;
    }
  }

  const region = detectAWSRegion(selectedProfile);

  ensureInfrawiseDir(cwd);

  writeYaml(cwd, {
    profile: selectedProfile,
    region,
    pgDetected,
    mysqlDetected,
    mongoDetected,
    iacDetected,
  });

  const anyDbDetected = pgDetected || mysqlDetected || mongoDetected;
  if (anyDbDetected) {
    writeSecrets(cwd, secrets);
  }

  console.log('');
  log.success('Generated infrawise.yaml');
  if (pgDetected && !secrets.postgres) {
    log.warn('Postgres detected — add connection string to .infrawise/secrets.yaml');
  }
  if (mysqlDetected && !secrets.mysql) {
    log.warn('MySQL detected — add connection string to .infrawise/secrets.yaml');
  }
  if (mongoDetected && !secrets.mongodb) {
    log.warn('MongoDB detected — add connection string to .infrawise/secrets.yaml');
  }
  console.log('');
}

function extractDbSecrets(env: Record<string, string>): {
  postgres?: string;
  mysql?: string;
  mongodb?: string;
} {
  const secrets: { postgres?: string; mysql?: string; mongodb?: string } = {};
  for (const key of ENV_KEYS.postgres) {
    if (env[key]) {
      secrets.postgres = env[key];
      break;
    }
  }
  for (const key of ENV_KEYS.mysql) {
    if (env[key]) {
      secrets.mysql = env[key];
      break;
    }
  }
  for (const key of ENV_KEYS.mongodb) {
    if (env[key]) {
      secrets.mongodb = env[key];
      break;
    }
  }
  return secrets;
}

function detectIaC(cwd: string): boolean {
  return scanDirForIaC(cwd, 3);
}

function scanDirForIaC(dir: string, depth: number): boolean {
  if (depth < 0) return false;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isFile()) {
        const n = entry.name;
        if (
          n.endsWith('.tf') ||
          n === 'cdk.json' ||
          n === 'template.yaml' ||
          n === 'template.yml'
        ) {
          return true;
        }
      } else if (entry.isDirectory() && depth > 0) {
        if (scanDirForIaC(path.join(dir, entry.name), depth - 1)) return true;
      }
    }
  } catch {
    // ignore permission errors
  }
  return false;
}

function ensureInfrawiseDir(cwd: string): void {
  const infrawiseDir = path.join(cwd, '.infrawise');
  if (!fs.existsSync(infrawiseDir)) {
    fs.mkdirSync(infrawiseDir, { recursive: true });
  }
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = '.infrawise/';
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes(entry)) {
      const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(gitignorePath, `${prefix}${entry}\n`);
    }
  } else {
    fs.writeFileSync(gitignorePath, `${entry}\n`);
  }
}

function writeYaml(
  cwd: string,
  opts: {
    profile: string;
    region: string;
    pgDetected: boolean;
    mysqlDetected: boolean;
    mongoDetected: boolean;
    iacDetected: boolean;
  },
): void {
  const config: Record<string, unknown> = {
    project: path.basename(cwd),
    aws: {
      profile: opts.profile,
      region: opts.region,
    },
    dynamodb: { enabled: true, includeTables: [] },
    postgres: { enabled: opts.pgDetected, connectionString: '' },
    mysql: { enabled: opts.mysqlDetected, connectionString: '' },
    mongodb: { enabled: opts.mongoDetected, connectionString: '', databases: [] },
    terraform: { enabled: opts.iacDetected },
    sqs: { enabled: true },
    sns: { enabled: true },
    ssm: { enabled: true, paths: [] },
    secretsManager: { enabled: true },
    lambda: { enabled: true },
    eventbridge: { enabled: true },
    rds: { enabled: false },
    s3: { enabled: true },
    apiGateway: { enabled: true },
    cloudwatchLogs: { enabled: false, logGroupPrefixes: [], windowHours: 24 },
    analysis: { sampleSize: 100 },
  };
  fs.writeFileSync(
    path.join(cwd, 'infrawise.yaml'),
    yaml.dump(config, { lineWidth: 120 }),
    'utf-8',
  );
}

function writeSecrets(
  cwd: string,
  secrets: { postgres?: string; mysql?: string; mongodb?: string },
): void {
  const data = {
    postgres: { connectionString: secrets.postgres ?? '' },
    mysql: { connectionString: secrets.mysql ?? '' },
    mongodb: { connectionString: secrets.mongodb ?? '' },
  };
  fs.writeFileSync(
    path.join(cwd, '.infrawise', 'secrets.yaml'),
    yaml.dump(data, { lineWidth: 120 }),
    'utf-8',
  );
}
