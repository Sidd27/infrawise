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

# ── 3. Generate config via infrawise init ────────────────────────────────────

echo ""
echo "▶ Generating infrawise.yaml..."
if [ ! -f infrawise.yaml ]; then
  AWS_ACCESS_KEY_ID=test \
  AWS_SECRET_ACCESS_KEY=test \
  AWS_ENDPOINT_URL=http://localhost:4566 \
  infrawise init
else
  echo "  infrawise.yaml already exists, skipping init"
fi

# ── 4. Done ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  LocalStack demo ready!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Analyze:"
echo ""
echo "    AWS_ACCESS_KEY_ID=test \\"
echo "    AWS_SECRET_ACCESS_KEY=test \\"
echo "    infrawise analyze"
echo ""
echo "  MCP server for Claude Code:"
echo ""
echo "    AWS_ACCESS_KEY_ID=test \\"
echo "    AWS_SECRET_ACCESS_KEY=test \\"
echo "    infrawise dev"
echo ""
echo "  Stop: docker compose down"
echo ""
