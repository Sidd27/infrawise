import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// BAD: SELECT * with no index on user_id → LargeSelect + MissingIndex
export async function getOrdersByUser(userId: number) {
  return pool.query('SELECT * FROM orders WHERE user_id = $1', [userId]);
}

// BAD: SELECT * with no index on status → LargeSelect + MissingIndex
export async function getOrdersByStatus(status: string) {
  return pool.query('SELECT * FROM orders WHERE status = $1', [status]);
}

// BAD: full table scan with SELECT * → LargeSelect + MissingIndex
export async function getAllEvents() {
  return pool.query('SELECT * FROM events');
}

// BAD: no index on order_id in payments → MissingIndex
export async function getPaymentsForOrder(orderId: number) {
  return pool.query('SELECT * FROM payments WHERE order_id = $1', [orderId]);
}

// BAD: N+1 — queries orders then payments individually per order
export async function getOrdersWithPayments(userId: number) {
  const ordersResult = await pool.query('SELECT * FROM orders WHERE user_id = $1', [userId]);
  for (const order of ordersResult.rows) {
    await pool.query('SELECT * FROM payments WHERE order_id = $1', [order.id]);
  }
}

// GOOD: users table has an index on email — no finding expected
export async function getUserByEmail(email: string) {
  return pool.query('SELECT id, name, email FROM users WHERE email = $1', [email]);
}
