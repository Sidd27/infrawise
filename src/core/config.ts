import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { InfrawiseConfig } from '../types';

export const InfrawiseConfigSchema = z.object({
  project: z.string().min(1, 'Project name is required'),
  aws: z
    .object({
      profile: z.string().optional().default('default'),
      region: z.string().optional().default('us-east-1'),
      endpoint: z.string().optional(),
    })
    .optional()
    .default({}),
  dynamodb: z.object({ enabled: z.boolean().optional().default(true), includeTables: z.array(z.string()).optional() }).optional(),
  postgres: z.object({
    enabled: z.boolean().optional().default(false),
    connectionString: z.string().optional(),
  }).optional(),
  mysql: z.object({
    enabled: z.boolean().optional().default(false),
    connectionString: z.string().optional(),
  }).optional(),
  mongodb: z.object({
    enabled: z.boolean().optional().default(false),
    connectionString: z.string().optional(),
    databases: z.array(z.string()).optional(),
  }).optional(),
  terraform: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  sqs: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  sns: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  ssm: z.object({
    enabled: z.boolean().optional().default(true),
    paths: z.array(z.string()).optional(),
  }).optional(),
  secretsManager: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  lambda: z.object({ enabled: z.boolean().optional().default(true) }).optional(),
  rds: z.object({ enabled: z.boolean().optional().default(false) }).optional(),
  kafka: z.object({ enabled: z.boolean().optional().default(false) }).optional(),
  cloudwatchLogs: z.object({
    enabled: z.boolean().optional().default(false),
    logGroupPrefixes: z.array(z.string()).optional(),
    windowHours: z.number().int().positive().optional().default(24),
  }).optional(),
  analysis: z.object({
    sampleSize: z.number().int().positive().optional().default(100),
  }).optional(),
});

export type ValidatedConfig = z.infer<typeof InfrawiseConfigSchema>;

export class ConfigError extends Error {
  constructor(message: string, public readonly details?: string[]) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(configPath?: string): InfrawiseConfig {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), 'infrawise.yaml');

  if (!fs.existsSync(resolvedPath)) {
    throw new ConfigError(`Configuration file not found at: ${resolvedPath}`, [
      'Run `infrawise init` to generate a configuration file',
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
    const details = result.error.errors.map((e) => `  - ${e.path.join('.')}: ${e.message}`);
    throw new ConfigError('Configuration validation failed', details);
  }

  return result.data as InfrawiseConfig;
}

export function generateDefaultConfig(projectName: string, options?: Partial<InfrawiseConfig>): string {
  const config: Record<string, unknown> = {
    project: projectName,
    aws: {
      profile: options?.aws?.profile ?? 'default',
      region: options?.aws?.region ?? 'us-east-1',
      ...(options?.aws?.endpoint ? { endpoint: options.aws.endpoint } : {}),
    },
    dynamodb: { enabled: options?.dynamodb?.enabled ?? true, includeTables: options?.dynamodb?.includeTables ?? [] },
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
    cloudwatchLogs: {
      enabled: options?.cloudwatchLogs?.enabled ?? false,
      logGroupPrefixes: options?.cloudwatchLogs?.logGroupPrefixes ?? [],
      windowHours: options?.cloudwatchLogs?.windowHours ?? 24,
    },
    analysis: { sampleSize: options?.analysis?.sampleSize ?? 100 },
  };

  return yaml.dump(config, { lineWidth: 120 });
}
