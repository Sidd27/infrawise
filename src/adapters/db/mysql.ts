import mysql from 'mysql2/promise';
import type { MySQLTableMetadata, ColumnDetail, ForeignKeyMetadata } from '../../types.js';
import { InfrawiseError, logger } from '../../core/index.js';

const SYSTEM_SCHEMAS = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);

function sanitizeConnectionDetail(s: string): string {
  return s.replace(/\/\/[^:/@]+:[^@]+@/g, '//***:***@');
}

export class MySQLConnectionError extends InfrawiseError {
  constructor(details?: string) {
    super(
      'Unable to connect to MySQL.\n\nPossible reasons:\n- invalid connection string\n- port 3306 not accessible\n- wrong credentials\n\nRun: infrawise doctor',
      undefined,
      undefined,
    );
    this.name = 'MySQLConnectionError';
    if (details) {
      this.message = `Unable to connect to MySQL.\n\nPossible reasons:\n- invalid connection string\n- port 3306 not accessible\n- wrong credentials\n\nRun: infrawise doctor\n\nDetail: ${sanitizeConnectionDetail(details)}`;
    }
  }
}

export type { MySQLTableMetadata };

export async function extractMySQLMetadata(
  connectionString: string,
): Promise<MySQLTableMetadata[]> {
  let connection: mysql.Connection | undefined;

  try {
    connection = await mysql.createConnection(connectionString);

    // Get all user tables
    const [tableRows] = await connection.execute<mysql.RowDataPacket[]>(
      `
      SELECT TABLE_SCHEMA, TABLE_NAME, ENGINE
      FROM information_schema.tables
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_SCHEMA NOT IN (${[...SYSTEM_SCHEMAS].map(() => '?').join(', ')})
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `,
      [...SYSTEM_SCHEMAS],
    );

    logger.debug(`Found ${tableRows.length} MySQL table(s)`);

    // Get all columns
    const [columnRows] = await connection.execute<mysql.RowDataPacket[]>(
      `
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM information_schema.columns
      WHERE TABLE_SCHEMA NOT IN (${[...SYSTEM_SCHEMAS].map(() => '?').join(', ')})
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
    `,
      [...SYSTEM_SCHEMAS],
    );

    // Get foreign keys
    const [fkRows] = await connection.execute<mysql.RowDataPacket[]>(
      `
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME,
             REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.key_column_usage
      WHERE REFERENCED_TABLE_NAME IS NOT NULL
        AND TABLE_SCHEMA NOT IN (${[...SYSTEM_SCHEMAS].map(() => '?').join(', ')})
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
    `,
      [...SYSTEM_SCHEMAS],
    );

    // Get all indexes
    const [indexRows] = await connection.execute<mysql.RowDataPacket[]>(
      `
      SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME
      FROM information_schema.statistics
      WHERE TABLE_SCHEMA NOT IN (${[...SYSTEM_SCHEMAS].map(() => '?').join(', ')})
      GROUP BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME
      ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME
    `,
      [...SYSTEM_SCHEMAS],
    );

    // Get primary keys
    const [pkRows] = await connection.execute<mysql.RowDataPacket[]>(
      `
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
      FROM information_schema.key_column_usage
      WHERE CONSTRAINT_NAME = 'PRIMARY'
        AND TABLE_SCHEMA NOT IN (${[...SYSTEM_SCHEMAS].map(() => '?').join(', ')})
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
    `,
      [...SYSTEM_SCHEMAS],
    );

    // Build lookup maps
    const columnMap = new Map<string, string[]>();
    const columnDetailMap = new Map<string, ColumnDetail[]>();
    for (const row of columnRows) {
      const key = `${row['TABLE_SCHEMA']}.${row['TABLE_NAME']}`;
      let cols = columnMap.get(key);
      if (!cols) {
        cols = [];
        columnMap.set(key, cols);
      }
      cols.push(row['COLUMN_NAME'] as string);
      let details = columnDetailMap.get(key);
      if (!details) {
        details = [];
        columnDetailMap.set(key, details);
      }
      details.push({
        name: row['COLUMN_NAME'] as string,
        dataType: row['DATA_TYPE'] as string,
        nullable: row['IS_NULLABLE'] === 'YES',
      });
    }

    const fkMap = new Map<string, ForeignKeyMetadata[]>();
    for (const row of fkRows) {
      const key = `${row['TABLE_SCHEMA']}.${row['TABLE_NAME']}`;
      let fks = fkMap.get(key);
      if (!fks) {
        fks = [];
        fkMap.set(key, fks);
      }
      fks.push({
        column: row['COLUMN_NAME'] as string,
        referencesTable: `${row['REFERENCED_TABLE_SCHEMA']}.${row['REFERENCED_TABLE_NAME']}`,
        referencesColumn: row['REFERENCED_COLUMN_NAME'] as string,
      });
    }

    const indexMap = new Map<string, string[]>();
    for (const row of indexRows) {
      const key = `${row['TABLE_SCHEMA']}.${row['TABLE_NAME']}`;
      let idxs = indexMap.get(key);
      if (!idxs) {
        idxs = [];
        indexMap.set(key, idxs);
      }
      const idxName = row['INDEX_NAME'] as string;
      if (!idxs.includes(idxName)) idxs.push(idxName);
    }

    const pkMap = new Map<string, string[]>();
    for (const row of pkRows) {
      const key = `${row['TABLE_SCHEMA']}.${row['TABLE_NAME']}`;
      let pks = pkMap.get(key);
      if (!pks) {
        pks = [];
        pkMap.set(key, pks);
      }
      pks.push(row['COLUMN_NAME'] as string);
    }

    // Assemble results
    const results: MySQLTableMetadata[] = [];
    for (const row of tableRows) {
      const schema = row['TABLE_SCHEMA'] as string;
      const table = row['TABLE_NAME'] as string;
      const engine = (row['ENGINE'] as string) ?? 'InnoDB';
      const key = `${schema}.${table}`;

      results.push({
        schema,
        table,
        columns: columnMap.get(key) ?? [],
        indexes: indexMap.get(key) ?? [],
        primaryKeys: pkMap.get(key) ?? [],
        engine,
        columnDetails: columnDetailMap.get(key) ?? [],
        foreignKeys: fkMap.get(key) ?? [],
      });
    }

    return results;
  } catch (err) {
    if (err instanceof MySQLConnectionError) throw err;
    throw new MySQLConnectionError(err instanceof Error ? err.message : String(err));
  } finally {
    if (connection) {
      await connection.end().catch(() => undefined);
    }
  }
}

export async function validateMySQLAccess(connectionString: string): Promise<boolean> {
  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(connectionString);
    await connection.execute('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    if (connection) {
      await connection.end().catch(() => undefined);
    }
  }
}
