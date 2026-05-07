import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { InfrawiseConfig } from '@infrawise/shared';

export const InfrawiseConfigSchema = z.object({
  project: z.string().min(1, 'Project name is required'),
  aws: z
    .object({
      profile: z.string().optional().default('default'),
      region: z.string().optional().default('us-east-1'),
    })
    .optional()
    .default({}),
  dynamodb: z
    .object({
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
  terraform: z
    .object({
      enabled: z.boolean().optional().default(true),
    })
    .optional(),
  analysis: z
    .object({
      sampleSize: z.number().int().positive().optional().default(100),
    })
    .optional(),
});

export type ValidatedConfig = z.infer<typeof InfrawiseConfigSchema>;

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(configPath?: string): InfrawiseConfig {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), 'infrawise.yaml');

  if (!fs.existsSync(resolvedPath)) {
    throw new ConfigError(
      `Configuration file not found at: ${resolvedPath}`,
      [
        'Run `infrawise init` to generate a configuration file',
        `Or specify a path with --config <path>`,
      ],
    );
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  } catch (err) {
    throw new ConfigError(`Unable to read configuration file: ${resolvedPath}`, [
      'Check file permissions',
      String(err),
    ]);
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = yaml.load(rawContent);
  } catch (err) {
    throw new ConfigError(`Invalid YAML in configuration file: ${resolvedPath}`, [
      'Check the YAML syntax',
      String(err),
    ]);
  }

  const result = InfrawiseConfigSchema.safeParse(parsedYaml);
  if (!result.success) {
    const details = result.error.errors.map((e) => `  - ${e.path.join('.')}: ${e.message}`);
    throw new ConfigError('Configuration validation failed', details);
  }

  return result.data as InfrawiseConfig;
}

export function generateDefaultConfig(projectName: string, options?: Partial<InfrawiseConfig>): string {
  const config = {
    project: projectName,
    aws: {
      profile: options?.aws?.profile ?? 'default',
      region: options?.aws?.region ?? 'us-east-1',
    },
    dynamodb: {
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
    terraform: {
      enabled: options?.terraform?.enabled ?? true,
    },
    analysis: {
      sampleSize: options?.analysis?.sampleSize ?? 100,
    },
  };

  return yaml.dump(config, { lineWidth: 120 });
}
