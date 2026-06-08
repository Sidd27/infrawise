# infrawise demo — Local databases

Tests infrawise against real database engines running locally in Docker. No cloud account or tokens needed — just Docker.

**Covered:** PostgreSQL · MySQL · MongoDB · Kafka (kafkajs code detection — no broker needed)

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- infrawise on your PATH (`npm install -g infrawise` or built from source)

---

## Start

```bash
cd demo/local
./start.sh
```

Starts Postgres, MySQL, and MongoDB, seeds each with intentional issues, then runs `infrawise start --claude` — analyzes your databases and opens Claude Code with all MCP tools ready.

**Every time after** (databases already running, cache fresh):

```bash
claude    # infrawise connects automatically via .mcp.json
```

**Connection strings** (pre-configured in `infrawise.yaml`):
- Postgres: `postgres://demo:demo@localhost:5432/demodb`
- MySQL: `mysql://demo:demo@localhost:3306/demodb`
- MongoDB: `mongodb://localhost:27017`

---

## What's seeded and why

### PostgreSQL (`localhost:5432`, db: `demodb`)
| Table | Issue |
|---|---|
| `orders` | No indexes on `user_id` or `status` |
| `payments` | No index on `order_id` |
| `events` | No indexes at all |
| `users` | Indexed on email — control |

### MySQL (`localhost:3306`, db: `demodb`)
| Table | Issue |
|---|---|
| `products` | No index on `sku` or `category` |
| `inventory` | No index on `product_id` |
| `shipments` | No indexes at all |
| `suppliers` | Indexed on email — control |

### MongoDB (`localhost:27017`, db: `appdb`)
| Collection | Issue |
|---|---|
| `sessions` | No indexes on `userId` or `token` |
| `activity_logs` | No indexes on `userId` or `action` |
| `notifications` | No indexes on `recipientId` or `status` |
| `users` | Indexed on email + role — control |

### Kafka (`event-service.ts` — AST analysis, no broker needed)
Infrawise detects kafkajs producer/consumer patterns from code, no live Kafka broker required.

| Topic | Usage |
|---|---|
| `order-events` | Producer (`publishOrderCreated`) + consumer (`startFulfillmentConsumer`) |
| `payment-events` | Producer (`publishPaymentProcessed`) |

---

## Stop

```bash
docker compose down
```

To also wipe all data:

```bash
docker compose down -v
```
