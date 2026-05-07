import { describe, it, expect } from 'vitest';
import { InfrawiseConfigSchema } from '../config';

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
      analysis: { sampleSize: 100 },
    };
    const result = InfrawiseConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBe('payments-service');
      expect(result.data.aws?.region).toBe('ap-south-1');
      expect(result.data.dynamodb?.includeTables).toContain('Orders');
      expect(result.data.postgres?.enabled).toBe(true);
      expect(result.data.analysis?.sampleSize).toBe(100);
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

  it('rejects negative sampleSize', () => {
    const result = InfrawiseConfigSchema.safeParse({
      project: 'test',
      analysis: { sampleSize: -10 },
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
