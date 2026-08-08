#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  infrawise demo — Floci"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Selects the `floci` AWS profile (must exist in your ~/.aws — see README).
[ -f .env ] && source .env
export AWS_PROFILE=floci

# ── 1. Start Floci ───────────────────────────────────────────────────────────

echo ""
echo "▶ Starting Floci..."
docker compose up -d

# Floci starts in milliseconds and publishes no health endpoint, so probe it
# with the same AWS CLI the seed uses — that is the readiness that matters.
echo "  Waiting for Floci to answer..."
for _ in $(seq 1 30); do
  if aws --endpoint-url=http://localhost:4566 --region=us-east-1 \
    sqs list-queues --no-cli-pager >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
echo "  ✓ Floci ready"

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
echo "  Stop Floci: docker compose down"
echo ""
