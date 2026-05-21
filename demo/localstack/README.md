# infrawise demo — LocalStack

Tests infrawise against AWS services emulated locally via LocalStack. Everything runs in Docker at zero cost — no real AWS account needed.

**Services covered:** DynamoDB · SQS · SNS · SSM · Secrets Manager · Lambda · CloudWatch Logs

> All services used here are available in LocalStack community edition (free). RDS requires LocalStack Pro and is not included.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [AWS CLI](https://aws.amazon.com/cli/) installed (`aws --version`)
- infrawise on your PATH (`npm install -g infrawise` or built from source)

---

## Start

```bash
cd demo/localstack
./start.sh
```

Starts LocalStack and seeds all AWS resources. Copy `.env.example` to `.env` and add your auth token before running — the token is required for `localstack:stable` and is free at [app.localstack.cloud](https://app.localstack.cloud).

---

## Analyze

Before running any infrawise command, load the LocalStack credentials into your shell:

```bash
source .env
```

> **Required every terminal session.** This sets `AWS_ACCESS_KEY_ID=test` and `AWS_SECRET_ACCESS_KEY=test` — dummy values LocalStack accepts. Without this, infrawise will fall through to your real AWS profile and fail. Not needed when using infrawise against a real AWS account.

Then configure and analyze:

```bash
infrawise init
infrawise analyze
```

When `infrawise init` asks **AWS profile**, select **`LocalStack (local development)`**. It will then ask for the endpoint — use the default `http://localhost:4566`.

### MCP server (Claude Code)

```bash
infrawise dev
```

Then add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "infrawise": {
      "command": "infrawise",
      "args": ["dev"],
      "env": {
        "AWS_ACCESS_KEY_ID": "test",
        "AWS_SECRET_ACCESS_KEY": "test"
      }
    }
  }
}
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
