---
title: LocalStack demo
description: Run Infrawise against emulated AWS services using LocalStack and Docker — no AWS account or real credentials needed. Expect 35+ findings seeded intentionally for testing.
---

LocalStack is an open-source tool that emulates AWS services locally using Docker. The Infrawise LocalStack demo seeds a set of intentionally misconfigured resources — missing DLQs, default Lambda memory, disabled secret rotation, visibility timeout mismatches, and more — so you can validate the full analysis pipeline without a real AWS account or incurring any AWS costs.

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
source .env
infrawise analyze --config infrawise.yaml
```

Expected: **35+ findings** across DynamoDB, SQS, Lambda, Secrets Manager, CloudWatch Logs, S3, and API Gateway.

## What the demo seeds

The `start.sh` script seeds the following resources, each with at least one intentional issue:

| Service         | Seeded resource                                           | Intentional issue                                                                                                             |
| --------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| DynamoDB        | `Orders` table                                            | Missing GSI; IaC drift from the local Terraform definition                                                                    |
| DynamoDB        | `LegacyOrders` table                                      | Deployed but not in Terraform (IaC drift)                                                                                     |
| SQS             | `orders-queue`                                            | No DLQ + not encrypted                                                                                                        |
| SQS             | `payment-events`                                          | No DLQ                                                                                                                        |
| SQS             | `orders-fifo.fifo`                                        | FIFO queue — exercises `isFifo` extraction                                                                                    |
| SQS             | `report-trigger-queue`                                    | Visibility timeout 10s with `generateReport` Lambda at 300s — fires visibility timeout mismatch finding                       |
| Lambda          | `processOrders`, `generateReport`                         | Default 128 MB memory; `generateReport` has a 300s timeout                                                                    |
| Secrets Manager | `demo/db-password`, `demo/stripe-api-key`                 | Rotation disabled on both secrets                                                                                             |
| CloudWatch Logs | `/aws/lambda/processOrders`, `/aws/lambda/generateReport` | No retention policy set                                                                                                       |
| S3              | `assets-bucket`                                           | Versioning disabled; public access not blocked; no encryption                                                                 |
| API Gateway     | `demo-api` (REST)                                         | 4 routes: `GET/POST /orders` → `processOrders`, `GET /reports` → `generateReport`, `POST /notifications` → `sendNotification` |

Running `infrawise analyze` against this environment should produce findings for every row above, confirming the analyzers and AWS adapters are working end-to-end.

## Use Claude Code against LocalStack

To connect Claude Code to the LocalStack demo environment, run this from the `demo/localstack` directory:

```bash
infrawise start --claude --config infrawise.yaml
```

This writes `.mcp.json` pointing Infrawise at the LocalStack config. Open Claude Code in the same directory — all 16 MCP tools are immediately available and running against the seeded LocalStack resources. Try asking: "What infrastructure issues should I fix first?"

For Cursor, use `--cursor` instead of `--claude`.

:::note
If you prefer an HTTP server (for debugging tool calls or a custom MCP client), run `infrawise serve --config infrawise.yaml`. The server starts at `POST http://localhost:3000/mcp`. This is not needed for Claude Code or Cursor.
:::

## Stop

```bash
docker compose down
```

---

## FAQ

### Why LocalStack instead of real AWS?

LocalStack lets you run the full Infrawise analysis pipeline without an AWS account, without read-only IAM setup, and without any risk of accidentally affecting real resources. The demo environment is deterministic — the same resources are seeded every time — which makes it useful for testing and for confirming that a new installation works correctly.

### Can I use the demo for CI testing?

Yes. `start.sh` is designed to be run in CI environments with Docker available. Set the `LOCALSTACK_AUTH_TOKEN` environment variable from a CI secret, run `./start.sh`, wait for the health check to pass, then run `infrawise check --config infrawise.yaml --fail-on high` to gate the build on high-severity findings (exit code 1 if any exist).
