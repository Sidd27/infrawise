---
title: LocalStack demo
description: Run Infrawise against emulated AWS services using LocalStack and Docker — no AWS account or real credentials needed. Expect 27+ findings seeded intentionally for testing.
---

LocalStack is an open-source tool that emulates AWS services locally using Docker. The Infrawise LocalStack demo seeds a set of intentionally misconfigured resources — missing DLQs, default Lambda memory, disabled secret rotation, and more — so you can validate the full analysis pipeline without a real AWS account or incurring any AWS costs.

This is also the recommended way to confirm that Infrawise is working correctly after installation, or to test changes to adapters and analyzers during development.

## Prerequisites

- Docker Desktop running
- AWS CLI installed
- Free LocalStack auth token from [app.localstack.cloud](https://app.localstack.cloud) (no credit card required)

## Start the demo

```bash
cd demo/localstack
cp .env.example .env        # paste your LocalStack auth token
./start.sh                  # starts LocalStack + seeds all resources
```

In a new terminal from the same directory:

```bash
source .env    # sets AWS_ACCESS_KEY_ID=test and AWS_SECRET_ACCESS_KEY=test
infrawise analyze --config infrawise.yaml
```

Expected: **27+ findings** across DynamoDB, SQS, Lambda, Secrets Manager, CloudWatch Logs, and S3.

## What the demo seeds

The `start.sh` script seeds the following resources, each with at least one intentional issue:

| Service | Seeded resource | Intentional issue |
|---|---|---|
| DynamoDB | `orders` table | Missing GSI for a common query pattern; IaC drift from the local Terraform definition |
| SQS | `order-processor` queue | No dead-letter queue configured |
| Lambda | `processOrder`, `sendNotification` | Default 128 MB memory; `processOrder` has a 300s+ timeout |
| Secrets Manager | `app/db-password`, `app/api-key` | Rotation disabled on both secrets |
| CloudWatch Logs | `/aws/lambda/processOrder` | No retention policy set |
| S3 | `app-uploads` bucket | Versioning disabled; public access block not set |

Running `infrawise analyze` against this environment should produce findings for every row above, confirming the analyzers and AWS adapters are working end-to-end.

## Start the MCP server against LocalStack

To test the MCP tools interactively against the demo environment:

```bash
infrawise dev --config infrawise.yaml
```

The server starts at `POST http://localhost:3000/mcp`. You can then use Claude Code or Cursor to call tools like `get_infra_overview` and `analyze_function` against the seeded LocalStack resources.

## Stop

```bash
docker compose down
```

---

## FAQ

### Why LocalStack instead of real AWS?

LocalStack lets you run the full Infrawise analysis pipeline without an AWS account, without read-only IAM setup, and without any risk of accidentally affecting real resources. The demo environment is deterministic — the same resources are seeded every time — which makes it useful for testing and for confirming that a new installation works correctly.

### Can I use the demo for CI testing?

Yes. `start.sh` is designed to be run in CI environments with Docker available. Set the `LOCALSTACK_AUTH_TOKEN` environment variable from a CI secret, run `./start.sh`, wait for the health check to pass, then run `infrawise analyze --config infrawise.yaml --json` to get machine-readable output you can assert against. The expected finding count is 27 or more.
