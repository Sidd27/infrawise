# infrawise demo — Local databases

Tests infrawise against real database engines running locally in Docker. No cloud account or tokens needed — just Docker.

**Databases covered:** PostgreSQL · MySQL · MongoDB

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

This starts Postgres, MySQL, and MongoDB, seeds each with intentional issues, and runs `infrawise init` to generate `infrawise.yaml`.

When `infrawise init` runs, configure connections:
- **Postgres**: `postgres://demo:demo@localhost:5432/demodb`
- **MySQL**: `mysql://demo:demo@localhost:3306/demodb`
- **MongoDB**: `mongodb://localhost:27017`

---

## Analyze

```bash
infrawise analyze
```

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
      "args": ["dev"]
    }
  }
}
```

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

---

## Stop

```bash
docker compose down
```

To also wipe all data:

```bash
docker compose down -v
```
