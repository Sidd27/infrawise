#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  infrawise demo — LocalStack"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Start LocalStack ──────────────────────────────────────────────────────

# Source .env if present so LOCALSTACK_AUTH_TOKEN reaches the container
[ -f .env ] && source .env

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

# ── 3. Done ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  LocalStack demo ready!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Load credentials (once per terminal session):"
echo ""
echo "    source .env"
echo ""
echo "  2. Configure infrawise:"
echo ""
echo "    infrawise init"
echo ""
echo "    When prompted for AWS profile, select: LocalStack (local development)"
echo "    Endpoint default is correct: http://localhost:4566"
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
