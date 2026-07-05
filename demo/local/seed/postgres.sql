-- ── Tables WITHOUT indexes (triggers MissingIndexAnalyzer, LargeSelectAnalyzer) ──

CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL,
  status      VARCHAR(50) NOT NULL,
  total       NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);
-- intentionally no index on user_id or status

CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id), -- FK exercises get_table_schema join paths
  amount      NUMERIC(10,2) NOT NULL,
  provider    VARCHAR(50),
  status      VARCHAR(50),
  created_at  TIMESTAMP DEFAULT NOW()
);
-- intentionally no index on order_id

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  entity_type VARCHAR(100),
  entity_id   INT,
  action      VARCHAR(100),
  payload     JSONB,
  created_at  TIMESTAMP DEFAULT NOW()
);
-- intentionally no indexes at all

-- ── Table WITH indexes (control — should produce no findings) ──

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) UNIQUE NOT NULL,
  name       VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ── Seed rows ──

INSERT INTO users (email, name) VALUES
  ('alice@example.com', 'Alice'),
  ('bob@example.com', 'Bob'),
  ('charlie@example.com', 'Charlie')
ON CONFLICT DO NOTHING;

INSERT INTO orders (user_id, status, total) VALUES
  (1, 'pending',   49.99),
  (1, 'completed', 129.00),
  (2, 'pending',   9.99),
  (3, 'failed',    0.00);

INSERT INTO payments (order_id, amount, provider, status) VALUES
  (1, 49.99,  'stripe', 'pending'),
  (2, 129.00, 'stripe', 'success'),
  (3, 9.99,   'paypal', 'pending');
