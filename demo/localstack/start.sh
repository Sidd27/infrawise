#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  infrawise demo — LocalStack"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Start LocalStack ──────────────────────────────────────────────────────

echo ""
echo "▶ Starting LocalStack..."
docker compose up -d

echo "  Waiting for LocalStack to be healthy..."
until docker compose ps localstack 2>/dev/null | grep -q "healthy"; do
  sleep 2
done
echo "  ✓ LocalStack ready"

# ── 2. Seed AWS resources ────────────────────────────────────────────────────

echo ""
echo "▶ Seeding AWS resources..."
AWS_ACCESS_KEY_ID=test \
AWS_SECRET_ACCESS_KEY=test \
bash seed/aws-seed.sh

# ── 3. Write .env with LocalStack credentials ────────────────────────────────

cat > .env << 'ENV'
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
ENV
echo "  ✓ .env written"

# ── 4. Done ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  LocalStack demo ready!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Load LocalStack credentials (once per terminal session):"
echo ""
echo "    source .env"
echo ""
echo "  2. Configure infrawise:"
echo ""
echo "    infrawise init"
echo ""
echo "  3. Analyze:"
echo ""
echo "    infrawise analyze"
echo ""
echo "  MCP server for Claude Code:"
echo ""
echo "    infrawise dev"
echo ""
echo "  Stop: docker compose down"
echo ""
