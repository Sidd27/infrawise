import { Pool } from 'pg';
import mysql from 'mysql2/promise';

const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
const mysqlConnection = mysql.createPool(process.env.MYSQL_URL ?? '');

export async function postgresTrailingColumn(customerId: number) {
  return pgPool.query('SELECT id FROM index_access_cases WHERE customer_id = $1', [customerId]);
}

export async function postgresLeadingColumns(tenantId: number, customerId: number) {
  return pgPool.query('SELECT id FROM index_access_cases WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId]);
}

export async function mysqlTrailingColumn(customerId: number) {
  return mysqlConnection.query('SELECT id FROM index_access_cases WHERE customer_id = ?', [customerId]);
}

export async function mysqlLeadingColumns(tenantId: number, customerId: number) {
  return mysqlConnection.query('SELECT id FROM index_access_cases WHERE tenant_id = ? AND customer_id = ?', [tenantId, customerId]);
}

export async function unresolvedQuery(sql: string) {
  return pgPool.query(sql);
}
