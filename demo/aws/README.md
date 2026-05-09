# infrawise demo — AWS (LocalStack)

Tests infrawise against AWS services emulated locally via LocalStack. Everything runs in Docker at zero cost — no real AWS account needed.

**Services covered:** DynamoDB · SQS · Lambda · Secrets Manager · CloudWatch Logs · SSM · SNS

> These are the free-tier LocalStack services that have infrawise analyzers. RDS and other services require a paid LocalStack plan and are not included here.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [AWS CLI](https://aws.amazon.com/cli/) installed (`aws --version`)
- A free [LocalStack account](https://app.localstack.cloud) + auth token
- infrawise on your PATH (`npm install -g infrawise` or built from source)

---

## One-time setup

```bash
cd demo/aws
cp .env.example .env
# edit .env and set your LocalStack auth token
```

---

## Start

```bash
./start.sh
```

This starts LocalStack, seeds all AWS resources, and runs `infrawise init` to generate `infrawise.yaml`.

---

## Analyze

```bash
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_ENDPOINT_URL=http://localhost:4566

infrawise analyze
```

### MCP server (Claude Code)

```bash
AWS_ACCESS_KEY_ID=test \
AWS_SECRET_ACCESS_KEY=test \
AWS_ENDPOINT_URL=http://localhost:4566 \
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
        "AWS_SECRET_ACCESS_KEY": "test",
        "AWS_ENDPOINT_URL": "http://localhost:4566"
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
