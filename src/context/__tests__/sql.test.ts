import { describe, expect, it } from 'vitest';
import { analyzeSql, sqlTableName } from '../sql.js';

describe('SQL access patterns', () => {
  it('resolves qualified table names without treating literals or comments as tables', () => {
    expect(sqlTableName("SELECT 'FROM fake' FROM public.orders WHERE id = $1")).toBe(
      'public.orders',
    );
    expect(sqlTableName('SELECT id /* FROM fake */ FROM `demodb`.`orders`')).toBe('demodb.orders');
    expect(sqlTableName('SELECT $$FROM fake$$ FROM public.orders')).toBe('public.orders');
    expect(sqlTableName("SELECT id FROM orders WHERE value = 'unfinished FROM fake")).toBe(
      'unknown',
    );
  });
  it('keeps predicate columns and operators, never literal values', () => {
    const result = analyzeSql(
      "SELECT * FROM orders WHERE tenant_id = $1 AND created_at >= '2026-01-01' ORDER BY created_at",
    );
    expect(result).toEqual({
      equalityColumns: ['tenant_id'],
      rangeColumns: ['created_at'],
      complete: true,
      hasWhere: true,
      selectAll: true,
    });
    expect(JSON.stringify(result)).not.toContain('2026');
  });
  it.each([
    'SELECT * FROM orders WHERE a = $1 OR b = $2',
    'SELECT * FROM orders WHERE lower(email) = $1',
    'SELECT * FROM a JOIN b ON a.id = b.id WHERE a.id = $1',
    'SELECT * FROM orders WHERE id IN (SELECT id FROM users)',
  ])('refuses to claim complete coverage for %s', (sql) =>
    expect(analyzeSql(sql).complete).toBe(false),
  );
});
