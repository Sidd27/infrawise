import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  ConfigError,
  InfrawiseConfigSchema,
  generateDefaultConfig,
  loadConfig,
  loadSecrets,
} from '../config.js';

describe('InfrawiseConfigSchema', () => {
  it('parses a valid minimal config', () => {
    const result = InfrawiseConfigSchema.safeParse({ project: 'my-service' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBe('my-service');
    }
  });

  it('parses a full config', () => {
    const input = {
      project: 'payments-service',
      aws: { profile: 'default', region: 'ap-south-1' },
      dynamodb: { includeTables: ['Orders', 'Payments'] },
      postgres: { enabled: true, connectionString: 'postgresql://localhost:5432/db' },
      analysis: { hotPartitionThreshold: 8 },
    };
    const result = InfrawiseConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBe('payments-service');
      expect(result.data.aws?.region).toBe('ap-south-1');
      expect(result.data.dynamodb?.includeTables).toContain('Orders');
      expect(result.data.postgres?.enabled).toBe(true);
      expect(result.data.analysis?.hotPartitionThreshold).toBe(8);
    }
  });

  it('rejects config missing project', () => {
    const result = InfrawiseConfigSchema.safeParse({ aws: { profile: 'default' } });
    expect(result.success).toBe(false);
  });

  it('rejects config with empty project name', () => {
    const result = InfrawiseConfigSchema.safeParse({ project: '' });
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const result = InfrawiseConfigSchema.safeParse({ project: 'test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aws?.profile).toBe('default');
      expect(result.data.aws?.region).toBe('us-east-1');
    }
  });

  it('rejects negative hotPartitionThreshold', () => {
    const result = InfrawiseConfigSchema.safeParse({
      project: 'test',
      analysis: { hotPartitionThreshold: -10 },
    });
    expect(result.success).toBe(false);
  });

  it('parses postgres without connectionString when disabled', () => {
    const result = InfrawiseConfigSchema.safeParse({
      project: 'test',
      postgres: { enabled: false },
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple DynamoDB tables', () => {
    const result = InfrawiseConfigSchema.safeParse({
      project: 'test',
      dynamodb: { includeTables: ['TableA', 'TableB', 'TableC'] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dynamodb?.includeTables).toHaveLength(3);
    }
  });
});

describe('loadSecrets', () => {
  it('returns empty object when .infrawise/secrets.yaml does not exist', () => {
    const result = loadSecrets('/nonexistent/path');
    expect(result).toEqual({});
  });

  it('reads postgres connectionString from secrets.yaml', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-secrets-'));
    const infrawiseDir = path.join(tmpDir, '.infrawise');
    fs.mkdirSync(infrawiseDir);
    fs.writeFileSync(
      path.join(infrawiseDir, 'secrets.yaml'),
      yaml.dump({ postgres: { connectionString: 'postgresql://user:pass@localhost:5432/db' } }),
    );
    try {
      const result = loadSecrets(tmpDir);
      expect(result.postgres?.connectionString).toBe('postgresql://user:pass@localhost:5432/db');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns empty object when secrets.yaml has invalid YAML', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-secrets-'));
    const infrawiseDir = path.join(tmpDir, '.infrawise');
    fs.mkdirSync(infrawiseDir);
    fs.writeFileSync(path.join(infrawiseDir, 'secrets.yaml'), '{ invalid yaml ::');
    try {
      const result = loadSecrets(tmpDir);
      expect(result).toEqual({});
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(contents: string): string {
    const file = path.join(tmpDir, 'infrawise.yaml');
    fs.writeFileSync(file, contents);
    return file;
  }

  it('throws when the file does not exist', () => {
    expect(() => loadConfig(path.join(tmpDir, 'missing.yaml'))).toThrow(ConfigError);
  });

  it('throws on invalid YAML', () => {
    expect(() => loadConfig(writeConfig('project: [unclosed'))).toThrow(ConfigError);
  });

  it('throws when the config fails schema validation', () => {
    expect(() => loadConfig(writeConfig('aws:\n  region: us-east-1\n'))).toThrow(ConfigError);
  });

  it('expands ${ENV_VAR} references and leaves unset ones literal', () => {
    process.env.INFRAWISE_TEST_PG = 'postgresql://from-env:5432/db';
    try {
      const config = loadConfig(
        writeConfig(
          'project: ${INFRAWISE_TEST_PG_MISSING}\n' +
            'postgres:\n' +
            '  enabled: true\n' +
            '  connectionString: ${INFRAWISE_TEST_PG}\n',
        ),
      );
      expect(config.postgres?.connectionString).toBe('postgresql://from-env:5432/db');
      expect(config.project).toBe('${INFRAWISE_TEST_PG_MISSING}');
    } finally {
      delete process.env.INFRAWISE_TEST_PG;
    }
  });

  it('lets secrets.yaml override the connection string in the config', () => {
    fs.mkdirSync(path.join(tmpDir, '.infrawise'));
    fs.writeFileSync(
      path.join(tmpDir, '.infrawise', 'secrets.yaml'),
      yaml.dump({ mysql: { connectionString: 'mysql://secret@localhost:3306/db' } }),
    );
    const config = loadConfig(
      writeConfig(
        'project: test\nmysql:\n  enabled: true\n  connectionString: mysql://placeholder\n',
      ),
    );
    expect(config.mysql?.connectionString).toBe('mysql://secret@localhost:3306/db');
  });
});

describe('generateDefaultConfig', () => {
  it('emits every key the schema knows about', () => {
    const generated = yaml.load(generateDefaultConfig('test')) as Record<string, unknown>;
    expect(Object.keys(generated).sort()).toEqual(Object.keys(InfrawiseConfigSchema.shape).sort());
  });

  it('produces a config the schema accepts', () => {
    const generated = yaml.load(generateDefaultConfig('test'));
    expect(InfrawiseConfigSchema.safeParse(generated).success).toBe(true);
  });
});
