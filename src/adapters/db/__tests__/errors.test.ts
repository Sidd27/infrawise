import { describe, it, expect } from 'vitest';
import { MySQLConnectionError } from '../mysql';
import { MongoConnectionError } from '../mongodb';
import { validatePostgresAccess } from '../postgres';
import { validateMySQLAccess } from '../mysql';
import { validateMongoAccess } from '../mongodb';

const UNREACHABLE = 'localhost:19999';

describe('MySQLConnectionError', () => {
  it('has correct name', () => {
    const err = new MySQLConnectionError();
    expect(err.name).toBe('MySQLConnectionError');
    expect(err).toBeInstanceOf(Error);
  });

  it('message includes guidance to run infrawise doctor', () => {
    const err = new MySQLConnectionError();
    expect(err.message).toContain('infrawise doctor');
  });

  it('appends detail when provided', () => {
    const err = new MySQLConnectionError('ECONNREFUSED 127.0.0.1:3306');
    expect(err.message).toContain('ECONNREFUSED 127.0.0.1:3306');
    expect(err.message).toContain('infrawise doctor');
  });
});

describe('MongoConnectionError', () => {
  it('has correct name', () => {
    const err = new MongoConnectionError();
    expect(err.name).toBe('MongoConnectionError');
    expect(err).toBeInstanceOf(Error);
  });

  it('message includes guidance to run infrawise doctor', () => {
    const err = new MongoConnectionError();
    expect(err.message).toContain('infrawise doctor');
  });

  it('appends detail when provided', () => {
    const err = new MongoConnectionError('ECONNREFUSED 127.0.0.1:27017');
    expect(err.message).toContain('ECONNREFUSED 127.0.0.1:27017');
  });
});

describe('validatePostgresAccess', () => {
  it('returns false for unreachable host', async () => {
    const result = await validatePostgresAccess(`postgresql://user:pass@${UNREACHABLE}/db`);
    expect(result).toBe(false);
  }, 10_000);
});

describe('validateMySQLAccess', () => {
  it('returns false for unreachable host', async () => {
    const result = await validateMySQLAccess(`mysql://user:pass@${UNREACHABLE}/db`);
    expect(result).toBe(false);
  }, 10_000);
});

describe('validateMongoAccess', () => {
  it('returns false for unreachable host', async () => {
    const result = await validateMongoAccess(`mongodb://${UNREACHABLE}/`);
    expect(result).toBe(false);
  }, 10_000);
});
