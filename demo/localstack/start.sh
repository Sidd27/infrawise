#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  infrawise demo — LocalStack"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Source .env — sets LOCALSTACK_AUTH_TOKEN for the container
# and AWS_* credentials for infrawise
[ -f .env ] && source .env
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test

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
bash seed/aws-seed.sh

# ── 3. Start infrawise + open Claude ────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

infrawise start --claude

# ── Cleanup hint ─────────────────────────────────────────────────────────────

echo ""
echo "  Stop LocalStack: docker compose down"
echo ""
