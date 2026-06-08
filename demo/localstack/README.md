# infrawise demo — LocalStack

Tests infrawise against AWS services emulated locally via LocalStack. Everything runs in Docker at zero cost — no real AWS account needed.

**Services covered:** DynamoDB · SQS · SNS · SSM · Secrets Manager · Lambda · CloudWatch Logs

> All services used here are available in LocalStack community edition (free). RDS requires LocalStack Pro and is not included.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [AWS CLI](https://aws.amazon.com/cli/) installed (`aws --version`)
- infrawise on your PATH (`npm install -g infrawise` or built from source)
- A free LocalStack auth token from [app.localstack.cloud](https://app.localstack.cloud)

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
