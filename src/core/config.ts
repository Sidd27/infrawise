import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { InfrawiseConfig } from '../types.js';
import { InfrawiseError } from './errors.js';

export const InfrawiseConfigSchema = z.object({
  project: z.string().min(1, 'Project name is required'),
  aws: z
    .object({
      profile: z.string().optional().default(''),
      region: z.string().optional().default('us-east-1'),
    })
    .optional()
    .default({ profile: 'default', region: 'us-east-1' }),
  dynamodb: z
    .object({
      enabled: z.boolean().optional().default(true),
      includeTables: z.array(z.string()).optional(),
    })
    .optional(),
  postgres: z
    .object({
      enabled: z.boolean().optional().default(false),
      connectionString: z.string().optional(),
    })
    .optional(),
  mysql: z
    .object({
      enabled: z.boolean().optional().default(false),
      connectionString: z.string().optional(),
    })
    .optional(),
  mongodb: z
    .object({
      enabled: z.boolean().optional().default(false),
      connectionString: z.string().optional(),
      databases: z.array(z.string()).optional(),
    })
    .optional(),
  terraform: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  sqs: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  sns: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  ssm: z
    .object({
      enabled: z.boolean().optional().default(true),
      paths: z.array(z.string()).optional(),
    })
    .optional(),
  secretsManager: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  lambda: z
    .object({
      enabled: z.boolean().optional().default(true),
      includeFunctions: z.array(z.string()).optional(),
    })
    .optional(),
  eventbridge: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  rds: z.object({ enabled: z.boolean().optional().default(false) }).optional(),
  s3: z.object({ enabled: z.boolean().optional().default(false) }).optional(),
  apiGateway: z.object({ enabled: z.boolean().optional().default(false) }).optional(),
  cognito: z.object({ enabled: z.boolean().optional().default(false) }).optional(),
  kinesis: z.object({ enabled: z.boolean().optional().default(false) }).optional(),
  msk: z.object({ enabled: z.boolean().optional().default(false) }).optional(),
  cloudwatchLogs: z
    .object({
      enabled: z.boolean().optional().default(false),
      logGroupPrefixes: z.array(z.string()).optional(),
      windowHours: z.number().int().positive().optional().default(24),
    })
    .optional(),
  analysis: z
    .object({
      sampleSize: z.number().int().positive().optional().default(100),
      hotPartitionThreshold: z.number().int().positive().optional().default(5),
      hotPartitionThresholds: z
        .record(z.string(), z.number().int().positive())
        .optional()
        .default({}),
    })
    .optional(),
});

export type ValidatedConfig = z.infer<typeof InfrawiseConfigSchema>;

export class ConfigError extends InfrawiseError {
  constructor(message: string, details?: string[]) {
    super(message, details, 'infrawise start');
    this.name = 'ConfigError';
  }
}

const SecretsSchema = z.object({
  postgres: z.object({ connectionString: z.string() }).optional(),
  mysql: z.object({ connectionString: z.string() }).optional(),
  mongodb: z.object({ connectionString: z.string() }).optional(),
});

type Secrets = z.infer<typeof SecretsSchema>;

export function loadSecrets(configDir: string): Secrets {
  const secretsPath = path.join(configDir, '.infrawise', 'secrets.yaml');
  if (!fs.existsSync(secretsPath)) return {};
  try {
    const raw = fs.readFileSync(secretsPath, 'utf-8');
    const parsed = yaml.load(raw);
    const result = SecretsSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export function loadConfig(configPath?: string): InfrawiseConfig {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), 'infrawise.yaml');

  if (!fs.existsSync(resolvedPath)) {
    throw new ConfigError(`Configuration file not found at: ${resolvedPath}`, [
      'Run `infrawise start` to generate a configuration file',
      `Or specify a path with --config <path>`,
    ]);
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  } catch (err) {
    throw new ConfigError(`Unable to read configuration file: ${resolvedPath}`, [String(err)]);
  }

  // Expand ${ENV_VAR} references — lets users store secrets in env, not in the YAML file
  rawContent = rawContent.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    const val = process.env[name];
    return val !== undefined ? val : match;
  });

  let parsedYaml: unknown;
  try {
    parsedYaml = yaml.load(rawContent);
  } catch (err) {
    throw new ConfigError(`Invalid YAML in configuration file: ${resolvedPath}`, [String(err)]);
  }

  const result = InfrawiseConfigSchema.safeParse(parsedYaml);
  if (!result.success) {
    const details = result.error.issues.map((e) => `  - ${e.path.join('.')}: ${e.message}`);
    throw new ConfigError('Configuration validation failed', details);
  }

  const config = result.data as InfrawiseConfig;

  const configDir = path.dirname(resolvedPath);
  const secrets = loadSecrets(configDir);
  if (secrets.postgres?.connectionString && config.postgres) {
    config.postgres.connectionString = secrets.postgres.connectionString;
  }
  if (secrets.mysql?.connectionString && config.mysql) {
    config.mysql.connectionString = secrets.mysql.connectionString;
  }
  if (secrets.mongodb?.connectionString && config.mongodb) {
    config.mongodb.connectionString = secrets.mongodb.connectionString;
  }

  return config;
}

export function generateDefaultConfig(
  projectName: string,
  options?: Partial<InfrawiseConfig>,
): string {
  const config: Record<string, unknown> = {
    project: projectName,
    aws: {
      profile: options?.aws?.profile ?? '',
      region: options?.aws?.region ?? 'us-east-1',
    },
    dynamodb: {
      enabled: options?.dynamodb?.enabled ?? true,
      includeTables: options?.dynamodb?.includeTables ?? [],
    },
    postgres: {
      enabled: options?.postgres?.enabled ?? false,
      connectionString: options?.postgres?.connectionString ?? '',
    },
    mysql: {
      enabled: options?.mysql?.enabled ?? false,
      connectionString: options?.mysql?.connectionString ?? '',
    },
    mongodb: {
      enabled: options?.mongodb?.enabled ?? false,
      connectionString: options?.mongodb?.connectionString ?? '',
      databases: options?.mongodb?.databases ?? [],
    },
    terraform: { enabled: options?.terraform?.enabled ?? true },
    sqs: { enabled: options?.sqs?.enabled ?? true },
    sns: { enabled: options?.sns?.enabled ?? true },
    ssm: {
      enabled: options?.ssm?.enabled ?? true,
      paths: options?.ssm?.paths ?? [],
    },
    secretsManager: { enabled: options?.secretsManager?.enabled ?? true },
    lambda: { enabled: options?.lambda?.enabled ?? true },
    eventbridge: { enabled: options?.eventbridge?.enabled ?? true },
    rds: { enabled: options?.rds?.enabled ?? false },
    s3: { enabled: options?.s3?.enabled ?? false },
    apiGateway: { enabled: options?.apiGateway?.enabled ?? false },
    cognito: { enabled: options?.cognito?.enabled ?? false },
    kinesis: { enabled: options?.kinesis?.enabled ?? false },
    msk: { enabled: options?.msk?.enabled ?? false },
    cloudwatchLogs: {
      enabled: options?.cloudwatchLogs?.enabled ?? false,
      logGroupPrefixes: options?.cloudwatchLogs?.logGroupPrefixes ?? [],
      windowHours: options?.cloudwatchLogs?.windowHours ?? 24,
    },
    analysis: {
      sampleSize: options?.analysis?.sampleSize ?? 100,
      hotPartitionThreshold: options?.analysis?.hotPartitionThreshold ?? 5,
    },
  };

  return yaml.dump(config, { lineWidth: 120 });
}
