# Demo Terraform config — intentionally has drift vs what's seeded in LocalStack
# infrawise reads this to detect IaC drift

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

# ── DynamoDB ─────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "orders" {
  name         = "Orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "orderId"

  attribute {
    name = "orderId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "users" {
  name         = "Users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  global_secondary_index {
    name            = "EmailIndex"
    hash_key        = "email"
    projection_type = "ALL"
  }
}

# ReportsTable — defined in IaC but NOT deployed (drift: defined_not_deployed)
resource "aws_dynamodb_table" "reports" {
  name         = "ReportsTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "reportId"

  attribute {
    name = "reportId"
    type = "S"
  }
}

# ── SQS ──────────────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "orders_dlq" {
  name = "orders-dlq"
}

resource "aws_sqs_queue" "orders" {
  name = "orders-queue"

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.orders_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "notifications" {
  name                    = "notifications-queue"
  sqs_managed_sse_enabled = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.orders_dlq.arn
    maxReceiveCount     = 3
  })
}

# archive-queue — defined in IaC but NOT deployed (drift: defined_not_deployed)
resource "aws_sqs_queue" "archive" {
  name = "archive-queue"
}

# ── Lambda ────────────────────────────────────────────────────────────────────

resource "aws_lambda_function" "process_orders" {
  function_name = "processOrders"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = "arn:aws:iam::000000000000:role/demo-role"
  filename      = "placeholder.zip"
  memory_size   = 128
  timeout       = 30
}

resource "aws_lambda_function" "send_notification" {
  function_name = "sendNotification"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = "arn:aws:iam::000000000000:role/demo-role"
  filename      = "placeholder.zip"
  memory_size   = 512
  timeout       = 15
}

# cleanupJob — defined in IaC but NOT deployed (drift: defined_not_deployed)
resource "aws_lambda_function" "cleanup_job" {
  function_name = "cleanupJob"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = "arn:aws:iam::000000000000:role/demo-role"
  filename      = "placeholder.zip"
}

output "orders_table_name" {
  description = "Name of the orders DynamoDB table"
  value       = aws_dynamodb_table.orders.name
}
