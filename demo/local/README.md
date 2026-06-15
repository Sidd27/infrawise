# infrawise demo — Local databases

Runs infrawise against real PostgreSQL, MySQL, and MongoDB in Docker, plus kafkajs topic detection from code. No cloud account or tokens needed — just Docker. The seed scripts populate each engine with intentional issues for infrawise to find.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- infrawise on your PATH (`npm install -g infrawise` or built from source)

---

## Run

```bash
cd demo/local
./start.sh    # starts Postgres/MySQL/MongoDB, seeds each, runs `infrawise start --claude`
```

After the first run, just open your editor — `.mcp.json` connects automatically.

Connection strings are pre-configured in [`infrawise.yaml`](infrawise.yaml). The seed data (with intentional issues) lives in [`seed/`](seed/), and the sample app exercised by the scanner is in [`app/`](app/).

Running the demo needs only Docker — infrawise scans `app/` statically. To edit the sample app with full type-checking, install its deps: `npm install` (this folder is a standalone package).

---

## Stop

```bash
docker compose down      # add -v to also wipe all data
```
