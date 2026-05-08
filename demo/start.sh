#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  infrawise demo environment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Start containers ──────────────────────────────────────────────────────

echo ""
echo "▶ Starting Docker services..."
docker compose up -d

echo "  Waiting for services to be healthy..."
for svc in localstack postgres mysql mongodb; do
  echo -n "    $svc..."
  until docker compose ps "$svc" 2>/dev/null | grep -q "healthy"; do
    sleep 2
  done
  echo " ready"
done

# ── 2. Seed Postgres ─────────────────────────────────────────────────────────

echo ""
echo "▶ Seeding Postgres..."
docker compose exec -T postgres psql -U demo -d demodb < seed/postgres.sql
echo "  ✓ Postgres seeded"

# ── 3. Seed MySQL ────────────────────────────────────────────────────────────

echo ""
echo "▶ Seeding MySQL..."
docker compose exec -T mysql mysql -u demo -pdemo demodb < seed/mysql.sql
echo "  ✓ MySQL seeded"

# ── 4. Seed MongoDB ──────────────────────────────────────────────────────────

echo ""
echo "▶ Seeding MongoDB..."
docker compose exec -T mongodb mongosh --quiet < seed/mongo-seed.js
echo "  ✓ MongoDB seeded"

# ── 5. Seed AWS (LocalStack) ─────────────────────────────────────────────────

echo ""
echo "▶ Seeding AWS resources in LocalStack..."
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
bash seed/aws-seed.sh

# ── 6. Done ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Demo environment ready!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Run infrawise from the demo directory:"
echo ""
echo "    cd demo"
echo "    AWS_ACCESS_KEY_ID=test \\"
echo "    AWS_SECRET_ACCESS_KEY=test \\"
echo "    AWS_ENDPOINT_URL=http://localhost:4566 \\"
echo "    infrawise analyze --config infrawise.yaml"
echo ""
echo "  Or start the MCP server for Claude Code:"
echo ""
echo "    AWS_ACCESS_KEY_ID=test \\"
echo "    AWS_SECRET_ACCESS_KEY=test \\"
echo "    AWS_ENDPOINT_URL=http://localhost:4566 \\"
echo "    infrawise dev --config infrawise.yaml"
echo ""
echo "  Stop everything:  docker compose down"
echo ""
