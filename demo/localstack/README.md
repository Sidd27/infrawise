# infrawise demo — LocalStack

Tests infrawise against AWS services emulated locally via LocalStack. Everything runs in Docker at zero cost — no real AWS account needed.

**Services covered:** DynamoDB · SQS (standard + FIFO) · SNS · SSM · Secrets Manager · Lambda · EventBridge · S3 · API Gateway · CloudWatch Logs

> All services used here are available in LocalStack community edition (free). API Gateway v2 (HTTP/WebSocket APIs) and RDS require LocalStack Pro and are not included — the demo uses REST APIs (v1).

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [AWS CLI](https://aws.amazon.com/cli/) installed (`aws --version`)
- infrawise on your PATH (`npm install -g infrawise` or built from source)
- A free LocalStack auth token from [app.localstack.cloud](https://app.localstack.cloud)
- A `localstack` AWS profile in your `~/.aws` (one-time setup — see below)

---

## One-time: add the `localstack` AWS profile

infrawise is an AWS tool — it talks to whatever endpoint your selected AWS profile points at. To point it at LocalStack, add a `localstack` profile to your AWS config. This is the only LocalStack-specific setup, and it lives in your AWS config, not in infrawise.

Append to `~/.aws/config`:

```ini
[profile localstack]
region = us-east-1
output = json
endpoint_url = http://localhost:4566
```

Append to `~/.aws/credentials`:

```ini
[localstack]
aws_access_key_id = test
aws_secret_access_key = test
```

LocalStack accepts any credentials, so `test`/`test` is fine. The `endpoint_url` line is what routes calls to LocalStack. The demo's `infrawise.yaml` uses `profile: localstack`, and `.env` sets `AWS_PROFILE=localstack` so the AWS SDK resolves this profile.

---

## Start

```bash
cd demo/localstack
cp .env.example .env    # add your LocalStack auth token
./start.sh
```

That's it. `start.sh` will:

1. Start LocalStack and wait for it to be healthy
2. Seed all AWS resources
3. Run `infrawise start --claude` — analyzes your infrastructure and opens Claude Code

**Every time after** (LocalStack already running, cache fresh):

```bash
claude    # infrawise connects automatically via .mcp.json
```

---

## What's seeded and why

### DynamoDB
| Table | Issue |
|---|---|
| `Orders` | No GSI — queries scan the full table |
| `LegacyOrders` | Deployed but not in `terraform/main.tf` (IaC drift) |
| `Users` | Has GSI on email — control |

### SQS
| Queue | Issue |
|---|---|
| `orders-queue` | No DLQ + not encrypted |
| `payment-events` | No DLQ |
| `orders-fifo.fifo` | FIFO queue — exercises `isFifo` extraction and IaC drift |
| `report-trigger-queue` | Visibility timeout 10s with `generateReport` Lambda at 300s — fires `VisibilityTimeoutMismatchAnalyzer` |
| `temp-processing-queue` | Deployed but not in Terraform (IaC drift) |
| `notifications-queue` | Has DLQ + encrypted — control |

### Secrets Manager
| Secret | Issue |
|---|---|
| `demo/db-password` | No rotation |
| `demo/stripe-api-key` | No rotation |

### Lambda
| Function | Issue |
|---|---|
| `processOrders` | Default 128 MB memory |
| `generateReport` | Default 128 MB memory + 300s timeout |
| `sendNotification` | 512 MB + 15s — control |

### CloudWatch Logs
| Log Group | Issue |
|---|---|
| `/aws/lambda/processOrders` | No retention policy |
| `/aws/lambda/generateReport` | No retention policy |
| `/app/audit-logs` | 400-day retention (too long) |
| `/app/api` | 90-day retention — control |

### API Gateway
| API | Routes |
|---|---|
| `demo-api` (REST) | `GET /orders` → `processOrders`, `POST /orders` → `processOrders`, `GET /reports` → `generateReport`, `POST /notifications` → `sendNotification` |

### IaC drift (`terraform/main.tf`)
| Resource | Drift |
|---|---|
| `ReportsTable` | Defined in Terraform, not deployed |
| `archive-queue` | Defined in Terraform, not deployed |
| `cleanupJob` | Defined in Terraform, not deployed |
| `LegacyOrders` | Deployed, not in Terraform |
| `temp-processing-queue` | Deployed, not in Terraform |

---

## Stop

```bash
docker compose down
```
