#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  infrawise demo — Local databases"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Start containers ──────────────────────────────────────────────────────

echo ""
echo "▶ Starting Docker services..."
docker compose up -d

echo "  Waiting for services to be healthy..."
for svc in postgres mysql mongodb; do
  echo -n "    $svc..."
  until docker compose ps "$svc" 2>/dev/null | grep -q "healthy"; do
    sleep 2
  done
  echo " ready"
done

# ── 2. Seed databases ────────────────────────────────────────────────────────

echo ""
echo "▶ Seeding Postgres..."
docker compose exec -T postgres psql -U demo -d demodb < seed/postgres.sql
echo "  ✓ Postgres seeded"

echo ""
echo "▶ Seeding MySQL..."
docker compose exec -T mysql mysql -u demo -pdemo demodb < seed/mysql.sql
echo "  ✓ MySQL seeded"

echo ""
echo "▶ Seeding MongoDB..."
docker compose exec -T mongodb mongosh --quiet < seed/mongo-seed.js
echo "  ✓ MongoDB seeded"

# ── 3. Generate config via infrawise init ────────────────────────────────────

echo ""
echo "▶ Generating infrawise.yaml..."
if [ ! -f infrawise.yaml ]; then
  infrawise init
else
  echo "  infrawise.yaml already exists, skipping init"
fi

# ── 4. Done ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Local demo ready!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Postgres  : localhost:5432  (user: demo  db: demodb)"
echo "  MySQL     : localhost:3306  (user: demo  db: demodb)"
echo "  MongoDB   : localhost:27017 (db: appdb)"
echo "  Kafka     : detected from kafkajs code patterns (no broker needed)"
echo ""
echo "  Analyze:"
echo ""
echo "    infrawise analyze"
echo ""
echo "  MCP server for Claude Code:"
echo ""
echo "    infrawise dev"
echo ""
echo "  Stop: docker compose down"
echo ""
