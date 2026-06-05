import { Pool } from 'pg';
import type { PostgresTableMetadata } from '../../types.js';
import { PostgresConnectionError, logger } from '../../core/index.js';

interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
}

interface IndexRow {
  schemaname: string;
  tablename: string;
  indexname: string;
}

interface PrimaryKeyRow {
  table_schema: string;
  table_name: string;
  column_name: string;
}

export async function extractPostgresMetadata(
  connectionString: string,
): Promise<PostgresTableMetadata[]> {
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });

  try {
    // Test connection
    const client = await pool.connect();

    try {
      // Get all user tables
      const tablesResult = await client.query<{ table_schema: string; table_name: string }>(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      `);

      logger.debug(`Found ${tablesResult.rows.length} PostgreSQL table(s)`);

      // Get all columns
      const columnsResult = await client.query<ColumnRow>(`
        SELECT table_schema, table_name, column_name
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name, ordinal_position
      `);

      // Get all indexes
      const indexesResult = await client.query<IndexRow>(`
        SELECT schemaname, tablename, indexname
        FROM pg_indexes
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schemaname, tablename, indexname
      `);

      // Get primary keys
      const primaryKeysResult = await client.query<PrimaryKeyRow>(`
        SELECT
          tc.table_schema,
          tc.table_name,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY tc.table_schema, tc.table_name
      `);

      // Build maps for columns, indexes, primary keys
      const columnMap = new Map<string, string[]>();
      for (const row of columnsResult.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        let cols = columnMap.get(key);
        if (!cols) {
          cols = [];
          columnMap.set(key, cols);
        }
        cols.push(row.column_name);
      }

      const indexMap = new Map<string, string[]>();
      for (const row of indexesResult.rows) {
        const key = `${row.schemaname}.${row.tablename}`;
        let idxs = indexMap.get(key);
        if (!idxs) {
          idxs = [];
          indexMap.set(key, idxs);
        }
        idxs.push(row.indexname);
      }

      const pkMap = new Map<string, string[]>();
      for (const row of primaryKeysResult.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        let pks = pkMap.get(key);
        if (!pks) {
          pks = [];
          pkMap.set(key, pks);
        }
        pks.push(row.column_name);
      }

      // Assemble results
      const results: PostgresTableMetadata[] = [];
      for (const table of tablesResult.rows) {
        const key = `${table.table_schema}.${table.table_name}`;
        results.push({
          schema: table.table_schema,
          table: table.table_name,
          columns: columnMap.get(key) ?? [],
          indexes: indexMap.get(key) ?? [],
          primaryKeys: pkMap.get(key) ?? [],
        });
      }

      return results;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof PostgresConnectionError) throw err;
    throw new PostgresConnectionError(
      err instanceof Error ? err.message : 'Unknown error connecting to PostgreSQL',
    );
  } finally {
    await pool.end();
  }
}

export async function validatePostgresAccess(connectionString: string): Promise<boolean> {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}
