#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

ENDPOINT="http://localhost:4566"
REGION="us-east-1"
AWS="aws --endpoint-url=$ENDPOINT --region=$REGION"

# Everything the LocalStack demo seeds, seeded identically here. Floci is a
# drop-in on the same port, so the base script needs no changes — this file only
# adds the services LocalStack community cannot emulate.
EMULATOR_NAME=Floci bash ../../localstack/seed/aws-seed.sh

echo ""
echo "🌱 Seeding Floci-only services..."

# ── API Gateway v2 (HTTP API) ────────────────────────────────────────────────

echo "  → API Gateway v2 (HTTP API)"

PROCESS_ORDERS_FUNC_ARN=$($AWS lambda get-function-configuration \
  --function-name processOrders \
  --query 'FunctionArn' --output text 2>/dev/null || echo "")

GENERATE_REPORT_FUNC_ARN=$($AWS lambda get-function-configuration \
  --function-name generateReport \
  --query 'FunctionArn' --output text 2>/dev/null || echo "")

# create-api mints a new id on every call, so re-running the seed used to leave
# a second orders-http-api behind. Reuse the existing one; only build routes and
# integrations when this run actually created the API.
HTTP_API_ID=$($AWS apigatewayv2 get-apis \
  --query 'Items[?Name==`orders-http-api`].ApiId | [0]' --output text --no-cli-pager 2>/dev/null || echo "")
if [ "$HTTP_API_ID" = "None" ]; then HTTP_API_ID=""; fi

HTTP_API_CREATED=""
if [ -z "$HTTP_API_ID" ]; then
  HTTP_API_ID=$($AWS apigatewayv2 create-api \
    --name orders-http-api \
    --protocol-type HTTP \
    --query 'ApiId' --output text --no-cli-pager 2>/dev/null || echo "")
  HTTP_API_CREATED=1
fi

if [ -n "$HTTP_API_ID" ] && [ -n "$HTTP_API_CREATED" ] && [ -n "$PROCESS_ORDERS_FUNC_ARN" ]; then
  # IntegrationUri is the BARE function ARN here, which is what CDK's
  # HttpLambdaIntegration produces. Route-to-Lambda attribution must resolve it
  # from this form, not only from the REST invoke-path form.
  ORDERS_INTEGRATION_ID=$($AWS apigatewayv2 create-integration \
    --api-id "$HTTP_API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "$PROCESS_ORDERS_FUNC_ARN" \
    --payload-format-version 2.0 \
    --query 'IntegrationId' --output text --no-cli-pager 2>/dev/null || echo "")

  if [ -n "$ORDERS_INTEGRATION_ID" ]; then
    $AWS apigatewayv2 create-route --api-id "$HTTP_API_ID" \
      --route-key 'GET /v2/orders' --target "integrations/$ORDERS_INTEGRATION_ID" \
      --no-cli-pager 2>/dev/null || true
    $AWS apigatewayv2 create-route --api-id "$HTTP_API_ID" \
      --route-key 'POST /v2/orders' --target "integrations/$ORDERS_INTEGRATION_ID" \
      --no-cli-pager 2>/dev/null || true
  fi

  # A qualified ARN (function:name:alias) — the name must resolve to
  # generateReport, not to the "live" qualifier.
  REPORTS_INTEGRATION_ID=$($AWS apigatewayv2 create-integration \
    --api-id "$HTTP_API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "${GENERATE_REPORT_FUNC_ARN}:live" \
    --payload-format-version 2.0 \
    --query 'IntegrationId' --output text --no-cli-pager 2>/dev/null || echo "")

  if [ -n "$REPORTS_INTEGRATION_ID" ]; then
    $AWS apigatewayv2 create-route --api-id "$HTTP_API_ID" \
      --route-key 'GET /v2/reports' --target "integrations/$REPORTS_INTEGRATION_ID" \
      --no-cli-pager 2>/dev/null || true
  fi

  # A route with no integration at all — get_api_routes should report lambda: null
  $AWS apigatewayv2 create-route --api-id "$HTTP_API_ID" \
    --route-key 'GET /v2/health' --no-cli-pager 2>/dev/null || true
fi

# ── CloudFront ───────────────────────────────────────────────────────────────

echo "  → CloudFront distribution"

# One distribution fronting two backends by path pattern: the HTTP API for
# /api/*, the assets bucket for everything else. Uses legacy ForwardedValues
# rather than a CachePolicyId so it applies against any CloudFront
# implementation; on real AWS a cache policy id resolves to its name instead.
if [ -n "$HTTP_API_ID" ]; then
  API_ORIGIN_DOMAIN="${HTTP_API_ID}.execute-api.${REGION}.amazonaws.com"

  $AWS cloudfront create-distribution --no-cli-pager 2>/dev/null --distribution-config "{
    \"CallerReference\": \"infrawise-demo-front-door\",
    \"Comment\": \"demo front door\",
    \"Enabled\": true,
    \"Aliases\": { \"Quantity\": 1, \"Items\": [\"app.demo.example.com\"] },
    \"Origins\": {
      \"Quantity\": 2,
      \"Items\": [
        {
          \"Id\": \"orders-api-origin\",
          \"DomainName\": \"$API_ORIGIN_DOMAIN\",
          \"CustomOriginConfig\": {
            \"HTTPPort\": 80,
            \"HTTPSPort\": 443,
            \"OriginProtocolPolicy\": \"https-only\"
          }
        },
        {
          \"Id\": \"assets-origin\",
          \"DomainName\": \"assets-bucket.s3.${REGION}.amazonaws.com\",
          \"S3OriginConfig\": { \"OriginAccessIdentity\": \"\" }
        }
      ]
    },
    \"DefaultCacheBehavior\": {
      \"TargetOriginId\": \"assets-origin\",
      \"ViewerProtocolPolicy\": \"redirect-to-https\",
      \"MinTTL\": 0,
      \"ForwardedValues\": {
        \"QueryString\": false,
        \"Cookies\": { \"Forward\": \"none\" }
      }
    },
    \"CacheBehaviors\": {
      \"Quantity\": 1,
      \"Items\": [
        {
          \"PathPattern\": \"/api/*\",
          \"TargetOriginId\": \"orders-api-origin\",
          \"ViewerProtocolPolicy\": \"allow-all\",
          \"MinTTL\": 0,
          \"ForwardedValues\": {
            \"QueryString\": true,
            \"Cookies\": { \"Forward\": \"all\" }
          }
        }
      ]
    }
  }" >/dev/null || true

  # Some emulators accept create-distribution and then return nothing from
  # list-distributions. That shows up as "CloudFront 0 distribution(s)", which
  # reads like an infrawise bug rather than a gap in the emulator, so check.
  CF_COUNT=$($AWS cloudfront list-distributions \
    --query 'length(DistributionList.Items || `[]`)' --output text --no-cli-pager 2>/dev/null || echo 0)
  if [ "$CF_COUNT" = "0" ]; then
    echo "    ! this emulator did not retain the distribution — CloudFront will show 0"
  fi
fi

# ── RDS ──────────────────────────────────────────────────────────────────────

echo "  → RDS instance"

# Publicly accessible, unencrypted, no backups, no deletion protection, single
# AZ — fires all five RDS analyzers at once.
$AWS rds create-db-instance \
  --db-instance-identifier demo-postgres \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --master-username demo \
  --master-user-password demo-password-123 \
  --allocated-storage 20 \
  --publicly-accessible \
  --backup-retention-period 0 \
  --no-storage-encrypted \
  --no-deletion-protection \
  --no-multi-az \
  --no-cli-pager 2>/dev/null || true

# ── MSK ──────────────────────────────────────────────────────────────────────

echo "  → MSK cluster"

# Floci backs MSK with a real Redpanda container, so this needs the Docker
# socket mount. Best effort: it is the heaviest resource in the seed.
$AWS kafka create-cluster-v2 \
  --cluster-name demo-events \
  --serverless '{"VpcConfigs":[{"SubnetIds":["subnet-demo1","subnet-demo2"]}]}' \
  --no-cli-pager 2>/dev/null || true

echo ""
echo "✅ Floci-only seed complete"
echo "   API Gateway v2 : orders-http-api — GET/POST /v2/orders → processOrders (bare ARN),"
echo "                    GET /v2/reports → generateReport (aliased ARN), GET /v2/health (no integration)"
if [ "${CF_COUNT:-0}" != "0" ]; then
  echo "   CloudFront     : demo front door — /api/* → orders-http-api (allow-all, fires a finding),"
  echo "                    default → assets-bucket"
else
  echo "   CloudFront     : not retained by this emulator (create accepted, list returns none)"
fi
echo "   RDS            : demo-postgres (public, unencrypted, no backups, no deletion protection, single AZ)"
echo "   MSK            : demo-events (serverless, best effort — needs the Docker socket)"
echo ""
echo "   Also present as local files (no emulator involved):"
echo "   terraform/     : IaC drift vs the seeded resources"
echo "   cdk.out/       : one current stack + one orphaned template (per-stack staleness)"
