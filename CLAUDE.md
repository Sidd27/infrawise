# Infrawise — Claude Code instructions

## Standing rules

- Follow KISS + SOLID. Simplest shape that works. Complexity must earn its place.
- No comments unless the WHY is non-obvious. No docstrings.
- **Always ask before committing or pushing. Never commit without explicit user approval.**
- Before any commit: run `pnpm lint && pnpm typecheck && pnpm test`. All must pass.
- When adding a new feature (new service type, new adapter, new tool): update `demo/local/app/` with a representative usage example and update `demo/local/infrawise.yaml` if needed. Demo must always stay in sync — no need to be asked.
- Keep `README.md` in sync with every feature change — analysis capabilities table, scanner support line, tool table, and configuration section. Do this automatically, not on request.
- **Version must be in sync everywhere on every release.** `package.json` is the source of truth. `src/server/index.ts` reads it dynamically — no manual update needed there. `server.json` (MCP Registry manifest, gitignored) is bumped automatically by the release script if the file exists.

## MCP tools — keep CLAUDE.md current

Any time you add, remove, or change an MCP tool in `src/server/index.ts`, update the tool reference section below to match:

- New tool → add a section with name, inputs, return shape, and when to call it
- Removed tool → delete its section
- Changed inputs or behavior → update the section
- New usage pattern → add it to "Recommended usage patterns"

The tool table in `README.md` (under "Using with Claude Code") must also be kept in sync.

## Source layout

Single flat package under `src/`. No workspace packages, no tsup, no monorepo tooling.

```
src/
  types.ts    shared type definitions
  core/       config, logger, cache
  graph/      graph engine
  adapters/   extractors (dynamodb, postgres, mysql, mongodb, aws, logs, terraform)
  analyzers/  rule-based analyzers
  context/    ts-morph AST scanner
  server/     Fastify MCP server (@modelcontextprotocol/sdk, Streamable HTTP)
  cli/        CLI commands
```

Build: `pnpm build` → `tsc --noEmit false --outDir dist`
Typecheck: `pnpm typecheck` → `tsc`
Test: `pnpm test` → vitest

---

## MCP tool reference

Infrawise exposes 13 tools via `POST http://localhost:3000/mcp` (JSON-RPC 2.0). Start the server with `infrawise dev`.

### `get_infra_overview`

**Start here.** Compact snapshot of everything — counts, all services, high-severity findings.

No inputs required.

Returns: summary counts (tables, functions, queues, topics, secrets, lambdas), list of databases and services, high-severity findings with recommendations.

**When to call:** At the start of any database or infrastructure task to understand what's in scope.

---

### `get_graph_summary`

Full graph: every node, every edge, all findings.

No inputs required.

Returns: all `nodes` (tables, functions, queues, lambdas, etc.), all `edges` (query, scan, publishes_to, etc.), all `findings` with severity/recommendation, summary counts.

**When to call:** When you need the full picture or are tracing relationships across multiple services.

---

### `analyze_function`

Analyze a single function for infrastructure issues.

| Input | Type | Required |
|---|---|---|
| `function` | string | yes |

Returns: file path, all services/tables accessed (with edge types), related findings, deduplicated recommendations.

**When to call:** When writing or reviewing a function that touches a database, queue, or other service.

---

### `suggest_gsi`

Ready-to-use GSI definition for a DynamoDB table.

| Input | Type | Required |
|---|---|---|
| `table` | string | yes |
| `attribute` | string | yes |

Returns: index name, partition key, projection type, billing mode, rationale, recommendation.

**When to call:** When a query pattern needs a GSI that doesn't exist, or analyzer flags a missing GSI.

---

### `postgres_index_suggestions`

Exact `CREATE INDEX` SQL for a PostgreSQL table column.

| Input | Type | Required |
|---|---|---|
| `table` | string | yes |
| `column` | string | yes |

Returns: `CREATE INDEX CONCURRENTLY` statement, rationale, partial index variant, ANALYZE reminder.

**When to call:** When analyzer flags a missing index, or writing a query that filters on a column.

---

### `suggest_mongo_index`

Exact `createIndex` command for a MongoDB collection field.

| Input | Type | Required |
|---|---|---|
| `collection` | string | yes |
| `field` | string | yes |

Returns: `db.collection.createIndex(...)` command, compound variant, text variant, explain query.

**When to call:** When a collection query lacks an index or a collection scan is flagged.

---

### `mysql_index_suggestions`

Exact `ALTER TABLE ADD INDEX` SQL for a MySQL table column.

| Input | Type | Required |
|---|---|---|
| `table` | string | yes |
| `column` | string | yes |

Returns: `ALTER TABLE ... ADD INDEX` statement, composite variant, EXPLAIN guidance.

**When to call:** When analyzer flags a missing MySQL index or full table scan.

---

### `get_queue_details`

All SQS queues with operational metadata.

No inputs required.

Returns: per-queue — name, provider, DLQ status, encryption, approximate message count, retention days, findings.

**When to call:** When reviewing messaging architecture, debugging backlogs, or checking DLQ coverage.

---

### `get_topic_details`

All SNS topics with subscription metadata.

No inputs required.

Returns: per-topic — name, provider, subscription count, encryption status.

**When to call:** When reviewing event fan-out patterns or subscription coverage.

---

### `get_secrets_overview`

All Secrets Manager secrets — names and rotation status only. **Values are never included.**

No inputs required.

Returns: per-secret — name, provider, rotation enabled, rotation interval days, findings.

**When to call:** When checking which secrets exist or whether rotation is configured.

---

### `get_parameter_overview`

All SSM Parameter Store parameters — names, types, tiers only. **Values are never included.**

No inputs required.

Returns: per-parameter — name, provider, type (String/SecureString/StringList), tier (Standard/Advanced).

**When to call:** When checking which config parameters exist for a service.

---

### `get_lambda_overview`

All Lambda functions with configuration metadata.

No inputs required.

Returns: per-function — name, runtime, memory (MB), timeout (sec), env var key names (values never included), findings.

**When to call:** When reviewing Lambda config, checking for default memory (128 MB), or high timeouts.

---

### `get_log_errors`

Recent error patterns from CloudWatch log groups. **Raw log messages are never included.**

| Input | Type | Required |
|---|---|---|
| `logGroup` | string | no — filters by name substring |

Returns: per-log-group — name, retention days, error count, top error patterns with frequency.

**When to call:** When investigating errors or checking which log groups have no retention policy.

---

## Recommended usage patterns

**Before writing a query:**
1. `get_infra_overview` → understand what tables/services exist
2. `analyze_function` on the relevant function → check existing patterns
3. `suggest_gsi` or `postgres_index_suggestions` if an index is needed

**Reviewing an entire service:**
1. `get_graph_summary` → full graph
2. Review high-severity findings
3. `analyze_function` for each flagged function

**Infrastructure health check:**
1. `get_infra_overview` → high-severity findings
2. `get_queue_details` → missing DLQs
3. `get_secrets_overview` → rotation disabled
4. `get_lambda_overview` → default memory / high timeout
5. `get_log_errors` → error patterns

## What infrawise never does

- Never reads secret values or parameter values
- Never reads raw log messages
- Never writes to AWS or your database
- Never executes DDL
- No telemetry — everything stays local
