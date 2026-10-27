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

The editor's MCP handshake and tool discovery do not run analysis. Its first infrastructure tool call loads the snapshot prepared by `start`; with a missing or expired cache, that first call waits for analysis instead. To exercise the cold path, stop the MCP server, move `.infrawise/cache` aside, and reconnect: tool discovery should complete before `get_infra_overview` performs the initial analysis.

Connection strings are pre-configured in [`infrawise.yaml`](infrawise.yaml). The seed data (with intentional issues) lives in [`seed/`](seed/), and the sample app exercised by the scanner is in [`app/`](app/).

Running the demo needs only Docker — infrawise scans `app/` statically. To edit the sample app with full type-checking, install its deps: `npm install` (this folder is a standalone package).

To exercise incremental scanning, run `infrawise serve --config infrawise.yaml` here and save `app/order-service.ts`. The first refresh initializes the scanner. Edit it again, or edit `app/inventory-service.py`: subsequent refreshes rescan the changed file and any TS/JS importers while retaining operations from the other demo files. Use `analyze_function` with the edited function and file to inspect the updated result. Temporarily remove a function's database call and save to verify its old access disappears; restore it afterward. No database metadata is re-read on these saves.

---

## Stop

```bash
docker compose down      # add -v to also wipe all data
```

## Confidence regression cases

`app/index-coverage.ts` and `app/sql-coverage.py` query `index_access_cases`, which has a primary key on `id` and a composite index `(tenant_id, customer_id)`. Filtering only on `customer_id` must produce an access-pattern warning despite those indexes; filtering on `tenant_id` and `customer_id` must not. `get_table_schema` must show ordered index columns. Dynamic SQL must appear in `get_graph_summary.unresolvedReferences` and the coverage counts, without asserting the accessed table is absent.

This demo enables a 15-minute background refresh. For a bounded smoke test, use a temporary config copy with `freshness.refreshIntervalMinutes: 1`, load the first snapshot, and verify `dataHealth.analyzedAt` advances after a minute without a tool-triggered cloud refresh. Source-only edits must keep that timestamp unchanged.

To exercise the CI negative control, point a temporary config's PostgreSQL connection at a closed local port: `infrawise check --config /path/to/copy.yaml` must exit 2. `--allow-incomplete` can permit exit 0 only if no blocking findings are present. Restore the connection before normal analysis.

After seeding, run `pnpm test:demo` from the repository root for the repeatable database/MCP regression suite. Add `--background` to include the one-minute refresh test. The script uses disposable copies of demo sources and caches, verifies the actual extracted PostgreSQL text-array/index metadata, and checks CLI incomplete-analysis exit codes. It requires the three demo databases to be running and seeded; it does not start or stop Docker.

The scanner memory regression runs independently of these databases: `pnpm test:memory` creates disposable large-project fixtures, including SQL constants, and checks full/incremental equivalence and the real `analyze` CLI under a 256 MiB heap. Demo source edits still use the same bounded async scanner; no emulator-specific source behavior is involved. Files over 2 MiB are reported as partial coverage instead of being silently omitted.
