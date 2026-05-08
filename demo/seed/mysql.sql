-- ── Tables WITHOUT indexes (triggers MissingMySQLIndexAnalyzer, MySQLFullTableScanAnalyzer) ──

CREATE TABLE IF NOT EXISTS products (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  sku         VARCHAR(100) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  price       DECIMAL(10,2) NOT NULL,
  category    VARCHAR(100),
  created_at  DATETIME DEFAULT NOW()
);
-- intentionally no index on sku or category

CREATE TABLE IF NOT EXISTS inventory (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  product_id  INT NOT NULL,
  warehouse   VARCHAR(100),
  quantity    INT DEFAULT 0,
  updated_at  DATETIME DEFAULT NOW()
);
-- intentionally no index on product_id

CREATE TABLE IF NOT EXISTS shipments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  order_ref   VARCHAR(100) NOT NULL,
  carrier     VARCHAR(100),
  status      VARCHAR(50),
  shipped_at  DATETIME
);
-- intentionally no index on order_ref or status

-- ── Table WITH indexes (control) ──

CREATE TABLE IF NOT EXISTS suppliers (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suppliers_email ON suppliers (email);

-- ── Seed rows ──

INSERT IGNORE INTO products (sku, name, price, category) VALUES
  ('SKU-001', 'Widget A', 9.99,  'widgets'),
  ('SKU-002', 'Widget B', 19.99, 'widgets'),
  ('SKU-003', 'Gadget X', 49.99, 'gadgets');

INSERT IGNORE INTO inventory (product_id, warehouse, quantity) VALUES
  (1, 'WH-EAST', 100),
  (2, 'WH-EAST', 50),
  (3, 'WH-WEST', 25);
