import mysql2 from 'mysql2/promise';

// Variable named "mysql" — matches MySQL pattern, does NOT match postgres pattern
const mysql = mysql2.createPool({ uri: process.env.MYSQL_URL });

// BAD: full table scan — no WHERE clause → MySQLFullTableScan
export async function getAllProducts() {
  const [rows] = await mysql.query('SELECT * FROM products');
  return rows;
}

// BAD: category has no index → MissingMySQLIndex
export async function getProductsByCategory(category: string) {
  const [rows] = await mysql.query('SELECT * FROM products WHERE category = ?', [category]);
  return rows;
}

// BAD: product_id has no index in inventory → MissingMySQLIndex
export async function getInventoryForProduct(productId: number) {
  const [rows] = await mysql.query('SELECT * FROM inventory WHERE product_id = ?', [productId]);
  return rows;
}

// BAD: order_ref has no index in shipments → MissingMySQLIndex
export async function getShipmentByOrderRef(orderRef: string) {
  const [rows] = await mysql.query('SELECT * FROM shipments WHERE order_ref = ?', [orderRef]);
  return rows;
}

// BAD: status has no index in shipments → MissingMySQLIndex
export async function getPendingShipments() {
  const [rows] = await mysql.query('SELECT * FROM shipments WHERE status = ?', ['pending']);
  return rows;
}

// GOOD: suppliers has unique index on email — no finding expected
export async function getSupplierByEmail(email: string) {
  const [rows] = await mysql.query('SELECT id, name FROM suppliers WHERE email = ?', [email]);
  return rows;
}
