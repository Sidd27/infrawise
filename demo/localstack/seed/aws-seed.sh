#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="http://localhost:4566"
REGION="us-east-1"
AWS="aws --endpoint-url=$ENDPOINT --region=$REGION"

echo "🌱 Seeding AWS resources in LocalStack..."

# ── DynamoDB ────────────────────────────────────────────────────────────────

echo "  → DynamoDB tables"

# Orders table — no GSI (triggers MissingGSIAnalyzer)
$AWS dynamodb create-table \
  --table-name Orders \
  --attribute-definitions AttributeName=orderId,AttributeType=S \
  --key-schema AttributeName=orderId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --no-cli-pager 2>/dev/null || true

# Users table — has GSI (control)
$AWS dynamodb create-table \
  --table-name Users \
  --attribute-definitions \
    AttributeName=userId,AttributeType=S \
    AttributeName=email,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --global-secondary-indexes '[{
    "IndexName": "EmailIndex",
    "KeySchema": [{"AttributeName": "email","KeyType": "HASH"}],
    "Projection": {"ProjectionType": "ALL"}
  }]' \
  --billing-mode PAY_PER_REQUEST \
  --no-cli-pager 2>/dev/null || true

# LegacyOrders — deployed but NOT in Terraform (IaC drift)
$AWS dynamodb create-table \
  --table-name LegacyOrders \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --no-cli-pager 2>/dev/null || true

# ── SQS ─────────────────────────────────────────────────────────────────────

echo "  → SQS queues"

$AWS sqs create-queue --queue-name orders-dlq --no-cli-pager 2>/dev/null || true
ORDERS_DLQ_ARN=$($AWS sqs get-queue-attributes \
  --queue-url "$ENDPOINT/000000000000/orders-dlq" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

# orders-queue — no DLQ, not encrypted (triggers MissingDLQAnalyzer + UnencryptedQueueAnalyzer)
$AWS sqs create-queue --queue-name orders-queue --no-cli-pager 2>/dev/null || true

# payment-events — no DLQ (triggers MissingDLQAnalyzer)
$AWS sqs create-queue --queue-name payment-events --no-cli-pager 2>/dev/null || true

# notifications-queue — has DLQ + encrypted (control)
$AWS sqs create-queue \
  --queue-name notifications-queue \
  --attributes "{
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$ORDERS_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\",
    \"SqsManagedSseEnabled\": \"true\"
  }" \
  --no-cli-pager 2>/dev/null || true

# temp-processing-queue — deployed but NOT in Terraform (IaC drift)
$AWS sqs create-queue --queue-name temp-processing-queue --no-cli-pager 2>/dev/null || true

# orders-fifo.fifo — FIFO queue (exercises isFifo extraction)
$AWS sqs create-queue \
  --queue-name orders-fifo.fifo \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"true"}' \
  --no-cli-pager 2>/dev/null || true

# report-trigger-queue — visibility timeout 10s, will trigger generateReport (300s timeout)
# This fires VisibilityTimeoutMismatchAnalyzer: 10s < 300s
$AWS sqs create-queue \
  --queue-name report-trigger-queue \
  --attributes '{"VisibilityTimeout":"10"}' \
  --no-cli-pager 2>/dev/null || true

# ── SNS ─────────────────────────────────────────────────────────────────────

echo "  → SNS topics"

ORDER_EVENTS_ARN=$($AWS sns create-topic --name order-events --no-cli-pager --query TopicArn --output text 2>/dev/null || true)
INVENTORY_ALERTS_ARN=$($AWS sns create-topic --name inventory-alerts --no-cli-pager --query TopicArn --output text 2>/dev/null || true)

# Subscribe notifications-queue to order-events with a filter policy
# Filter requires 'eventType' and 'region' attributes — publishers must include these
NOTIFICATIONS_QUEUE_ARN=$($AWS sqs get-queue-attributes \
  --queue-url "http://localhost:4566/000000000000/notifications-queue" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text 2>/dev/null || true)

if [ -n "$ORDER_EVENTS_ARN" ] && [ -n "$NOTIFICATIONS_QUEUE_ARN" ]; then
  SUB_ARN=$($AWS sns subscribe \
    --topic-arn "$ORDER_EVENTS_ARN" \
    --protocol sqs \
    --notification-endpoint "$NOTIFICATIONS_QUEUE_ARN" \
    --no-cli-pager --query SubscriptionArn --output text 2>/dev/null || true)

  if [ -n "$SUB_ARN" ] && [ "$SUB_ARN" != "None" ]; then
    $AWS sns set-subscription-attributes \
      --subscription-arn "$SUB_ARN" \
      --attribute-name FilterPolicy \
      --attribute-value '{"eventType":["order.created","order.updated"],"region":["us-east-1","us-west-2"]}' \
      --no-cli-pager 2>/dev/null || true
  fi
fi

# ── SSM Parameter Store ──────────────────────────────────────────────────────

echo "  → SSM parameters"

$AWS ssm put-parameter --name "/demo/database-url" \
  --value "postgres://demo:demo@localhost:5432/demodb" \
  --type SecureString --overwrite --no-cli-pager 2>/dev/null || true

$AWS ssm put-parameter --name "/demo/api-key" \
  --value "sk-demo-1234567890" \
  --type SecureString --overwrite --no-cli-pager 2>/dev/null || true

$AWS ssm put-parameter --name "/demo/feature-flags" \
  --value '{"newCheckout":true}' \
  --type String --overwrite --no-cli-pager 2>/dev/null || true

# ── Secrets Manager ──────────────────────────────────────────────────────────

echo "  → Secrets Manager"

$AWS secretsmanager create-secret \
  --name "demo/db-password" \
  --secret-string '{"password":"super-secret-123"}' \
  --no-cli-pager 2>/dev/null || true

$AWS secretsmanager create-secret \
  --name "demo/stripe-api-key" \
  --secret-string '{"key":"sk_test_demo"}' \
  --no-cli-pager 2>/dev/null || true

# ── Lambda ───────────────────────────────────────────────────────────────────

echo "  → Lambda functions"

TMPDIR=$(mktemp -d)
echo 'exports.handler = async (e) => ({ statusCode: 200 });' > "$TMPDIR/index.js"
(cd "$TMPDIR" && zip -q function.zip index.js)

# processOrders — 128MB default memory (triggers LambdaDefaultMemoryAnalyzer)
$AWS lambda create-function \
  --function-name processOrders \
  --runtime nodejs20.x \
  --role arn:aws:iam::000000000000:role/demo-role \
  --handler index.handler \
  --zip-file "fileb://$TMPDIR/function.zip" \
  --memory-size 128 --timeout 30 \
  --no-cli-pager 2>/dev/null || true

# generateReport — 128MB + 300s timeout (triggers both Lambda analyzers)
$AWS lambda create-function \
  --function-name generateReport \
  --runtime nodejs20.x \
  --role arn:aws:iam::000000000000:role/demo-role \
  --handler index.handler \
  --zip-file "fileb://$TMPDIR/function.zip" \
  --memory-size 128 --timeout 300 \
  --no-cli-pager 2>/dev/null || true

# sendNotification — well configured (control)
$AWS lambda create-function \
  --function-name sendNotification \
  --runtime nodejs20.x \
  --role arn:aws:iam::000000000000:role/demo-role \
  --handler index.handler \
  --zip-file "fileb://$TMPDIR/function.zip" \
  --memory-size 512 --timeout 15 \
  --no-cli-pager 2>/dev/null || true

rm -rf "$TMPDIR"

# ── S3 ──────────────────────────────────────────────────────────────────────

echo "  → S3 buckets"

# uploads-bucket — versioning + SSE + notification → processOrders (exercises back-propagation)
$AWS s3api create-bucket --bucket uploads-bucket --no-cli-pager 2>/dev/null || true
$AWS s3api put-bucket-versioning \
  --bucket uploads-bucket \
  --versioning-configuration Status=Enabled \
  --no-cli-pager 2>/dev/null || true
$AWS s3api put-bucket-encryption \
  --bucket uploads-bucket \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
  --no-cli-pager 2>/dev/null || true
$AWS s3api put-public-access-block \
  --bucket uploads-bucket \
  --public-access-block-configuration 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' \
  --no-cli-pager 2>/dev/null || true

# Get processOrders Lambda ARN (seeded earlier in this script)
PROCESS_ORDERS_ARN=$($AWS lambda get-function-configuration \
  --function-name processOrders \
  --query 'FunctionArn' --output text 2>/dev/null || echo "arn:aws:lambda:us-east-1:000000000000:function:processOrders")
$AWS s3api put-bucket-notification-configuration \
  --bucket uploads-bucket \
  --notification-configuration "{\"LambdaFunctionConfigurations\":[{\"LambdaFunctionArn\":\"$PROCESS_ORDERS_ARN\",\"Events\":[\"s3:ObjectCreated:*\"],\"Filter\":{\"Key\":{\"FilterRules\":[{\"Name\":\"prefix\",\"Value\":\"uploads/\"}]}}}]}" \
  --no-cli-pager 2>/dev/null || true

# assets-bucket — public, no versioning, no encryption (fires S3PublicAccessAnalyzer + S3MissingVersioningAnalyzer + S3UnencryptedAnalyzer)
$AWS s3api create-bucket --bucket assets-bucket --no-cli-pager 2>/dev/null || true

# logs-archive-bucket — encrypted + blocked public access, no versioning (fires S3MissingVersioningAnalyzer)
$AWS s3api create-bucket --bucket logs-archive-bucket --no-cli-pager 2>/dev/null || true
$AWS s3api put-bucket-encryption \
  --bucket logs-archive-bucket \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
  --no-cli-pager 2>/dev/null || true
$AWS s3api put-public-access-block \
  --bucket logs-archive-bucket \
  --public-access-block-configuration 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' \
  --no-cli-pager 2>/dev/null || true

# ── Event Source Mappings (SQS → Lambda) ────────────────────────────────────

echo "  → Event source mappings"

ORDERS_QUEUE_ARN=$($AWS sqs get-queue-attributes \
  --queue-url "$ENDPOINT/000000000000/orders-queue" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text 2>/dev/null || echo "")

# orders-queue triggers processOrders — queue has no DLQ (triggers LambdaMissingTriggerDLQAnalyzer)
if [ -n "$ORDERS_QUEUE_ARN" ]; then
  $AWS lambda create-event-source-mapping \
    --function-name processOrders \
    --event-source-arn "$ORDERS_QUEUE_ARN" \
    --batch-size 10 \
    --no-cli-pager 2>/dev/null || true
fi

# report-trigger-queue triggers generateReport — visibility timeout (10s) < Lambda timeout (300s)
# This fires VisibilityTimeoutMismatchAnalyzer
REPORT_TRIGGER_QUEUE_ARN=$($AWS sqs get-queue-attributes \
  --queue-url "$ENDPOINT/000000000000/report-trigger-queue" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text 2>/dev/null || echo "")
if [ -n "$REPORT_TRIGGER_QUEUE_ARN" ]; then
  $AWS lambda create-event-source-mapping \
    --function-name generateReport \
    --event-source-arn "$REPORT_TRIGGER_QUEUE_ARN" \
    --batch-size 5 \
    --no-cli-pager 2>/dev/null || true
fi

# ── EventBridge Rules ────────────────────────────────────────────────────────

echo "  → EventBridge rules"

# Scheduled rule triggers generateReport every hour
$AWS events put-rule \
  --name "generate-report-schedule" \
  --schedule-expression "rate(1 hour)" \
  --state ENABLED \
  --no-cli-pager 2>/dev/null || true

GENERATE_REPORT_ARN=$($AWS lambda get-function \
  --function-name generateReport \
  --query 'Configuration.FunctionArn' --output text 2>/dev/null || echo "")

if [ -n "$GENERATE_REPORT_ARN" ]; then
  $AWS events put-targets \
    --rule "generate-report-schedule" \
    --targets "Id=1,Arn=$GENERATE_REPORT_ARN" \
    --no-cli-pager 2>/dev/null || true
fi

# Order created event triggers sendNotification
$AWS events put-rule \
  --name "order-created-event" \
  --event-pattern '{"source":["com.demo.orders"],"detail-type":["OrderCreated"]}' \
  --state ENABLED \
  --no-cli-pager 2>/dev/null || true

SEND_NOTIFICATION_ARN=$($AWS lambda get-function \
  --function-name sendNotification \
  --query 'Configuration.FunctionArn' --output text 2>/dev/null || echo "")

if [ -n "$SEND_NOTIFICATION_ARN" ]; then
  $AWS events put-targets \
    --rule "order-created-event" \
    --targets "Id=1,Arn=$SEND_NOTIFICATION_ARN" \
    --no-cli-pager 2>/dev/null || true
fi

# ── API Gateway ──────────────────────────────────────────────────────────────

echo "  → API Gateway"

PROCESS_ORDERS_FUNC_ARN=$($AWS lambda get-function-configuration \
  --function-name processOrders \
  --query 'FunctionArn' --output text 2>/dev/null || echo "arn:aws:lambda:us-east-1:000000000000:function:processOrders")

GENERATE_REPORT_FUNC_ARN=$($AWS lambda get-function-configuration \
  --function-name generateReport \
  --query 'FunctionArn' --output text 2>/dev/null || echo "arn:aws:lambda:us-east-1:000000000000:function:generateReport")

SEND_NOTIFICATION_FUNC_ARN=$($AWS lambda get-function-configuration \
  --function-name sendNotification \
  --query 'FunctionArn' --output text 2>/dev/null || echo "arn:aws:lambda:us-east-1:000000000000:function:sendNotification")

# HTTP API (v2) — demo-api
# REST API (v1) — demo-api
DEMO_API_ID=$($AWS apigateway create-rest-api \
  --name "demo-api" \
  --query 'id' --output text --no-cli-pager 2>/dev/null || echo "")

if [ -n "$DEMO_API_ID" ]; then
  ROOT_ID=$($AWS apigateway get-resources \
    --rest-api-id "$DEMO_API_ID" \
    --query 'items[?path==`/`].id' --output text --no-cli-pager 2>/dev/null || echo "")

  # Helper to create a resource + method + Lambda integration
  create_route() {
    local method="$1" path_part="$2" lambda_arn="$3"
    RESOURCE_ID=$($AWS apigateway create-resource \
      --rest-api-id "$DEMO_API_ID" \
      --parent-id "$ROOT_ID" \
      --path-part "$path_part" \
      --query 'id' --output text --no-cli-pager 2>/dev/null || echo "")
    if [ -n "$RESOURCE_ID" ]; then
      $AWS apigateway put-method \
        --rest-api-id "$DEMO_API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method "$method" \
        --authorization-type NONE \
        --no-cli-pager 2>/dev/null || true
      $AWS apigateway put-integration \
        --rest-api-id "$DEMO_API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method "$method" \
        --type AWS_PROXY \
        --integration-http-method POST \
        --uri "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/$lambda_arn/invocations" \
        --no-cli-pager 2>/dev/null || true
    fi
  }

  create_route GET orders "$PROCESS_ORDERS_FUNC_ARN"
  create_route POST orders "$PROCESS_ORDERS_FUNC_ARN"
  create_route GET reports "$GENERATE_REPORT_FUNC_ARN"
  create_route POST notifications "$SEND_NOTIFICATION_FUNC_ARN"
fi

# ── CloudWatch Log Groups ────────────────────────────────────────────────────

echo "  → CloudWatch log groups"

$AWS logs create-log-group --log-group-name "/aws/lambda/processOrders" --no-cli-pager 2>/dev/null || true
$AWS logs create-log-group --log-group-name "/aws/lambda/generateReport" --no-cli-pager 2>/dev/null || true

$AWS logs create-log-group --log-group-name "/app/audit-logs" --no-cli-pager 2>/dev/null || true
$AWS logs put-retention-policy --log-group-name "/app/audit-logs" --retention-in-days 400 --no-cli-pager 2>/dev/null || true

$AWS logs create-log-group --log-group-name "/app/api" --no-cli-pager 2>/dev/null || true
$AWS logs put-retention-policy --log-group-name "/app/api" --retention-in-days 90 --no-cli-pager 2>/dev/null || true

echo ""
echo "✅ AWS seed complete"
echo "   DynamoDB    : Orders (no GSI), LegacyOrders (IaC drift), Users (control)"
echo "   SQS         : orders-queue (no DLQ+unencrypted), payment-events (no DLQ), orders-fifo.fifo (FIFO), report-trigger-queue (visibility 10s mismatch), temp-processing-queue (IaC drift)"
echo "   Secrets     : db-password + stripe-api-key (no rotation)"
echo "   Lambda      : processOrders (128MB, SQS trigger), generateReport (128MB+300s, EventBridge+SQS trigger), sendNotification (control)"
echo "   EventBridge : generate-report-schedule (rate), order-created-event (pattern)"
echo "   API Gateway : demo-api (REST) — GET/POST /orders → processOrders, GET /reports → generateReport, POST /notifications → sendNotification"
echo "   Logs        : processOrders + generateReport (no retention), audit-logs (400 days)"
