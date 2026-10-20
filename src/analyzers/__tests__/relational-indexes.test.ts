import { describe, expect, it } from 'vitest';
import { relationalIndexFindings } from '../relational-indexes.js';
import { buildGraph } from '../../graph/index.js';
import { analyzeSql } from '../../context/sql.js';
import type { RelationalIndex } from '../../types.js';

describe.each(['postgres', 'mysql'] as const)('%s index coverage', (engine) => {
  const check = (
    columns: string[],
    sql = 'SELECT id FROM orders WHERE customer_id = $1',
    extra: Partial<RelationalIndex> = {},
  ) => {
    const table = {
      schema: 'public',
      table: 'orders',
      columns: ['id', 'customer_id', 'tenant_id'],
      indexes: ['idx'],
      primaryKeys: ['id'],
      engine: 'InnoDB',
      indexDetails: [
        { name: 'idx', columns, method: 'btree', partial: false, valid: true, ...extra },
      ],
    };
    return relationalIndexFindings(
      buildGraph(
        [
          {
            functionName: 'read',
            operationType: 'query',
            serviceType: engine,
            target: 'orders',
            filePath: 'handler.ts',
            sqlAccess: analyzeSql(sql),
          },
        ],
        [],
        engine === 'postgres' ? [table] : [],
        engine === 'mysql' ? [table] : [],
      ),
      engine,
    );
  };
  it('an unrelated primary key does not hide a missing predicate index', () =>
    expect(check(['id'])).toHaveLength(1));
  it('a matching leading column covers the access pattern', () =>
    expect(check(['customer_id', 'tenant_id'])).toEqual([]));
  it('a trailing column alone does not establish index coverage', () =>
    expect(check(['tenant_id', 'customer_id'])).toHaveLength(1));
  it('equality on the leading column allows a composite-index access path', () =>
    expect(
      check(
        ['tenant_id', 'customer_id'],
        'SELECT id FROM orders WHERE customer_id = $1 AND tenant_id = $2',
      ),
    ).toEqual([]));
  it('does not claim a missing index for unsupported predicates or partial indexes', () => {
    expect(check(['id'], 'SELECT id FROM orders WHERE lower(customer_id) = $1')).toEqual([]);
    expect(check(['customer_id'], undefined, { partial: true })).toEqual([]);
  });
  it('an invalid index cannot establish coverage', () =>
    expect(check(['customer_id'], undefined, { valid: false })).toHaveLength(1));
});
