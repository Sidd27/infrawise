# Infrawise — AI instructions

## Pre-release checklist — NO EXCEPTIONS

Before running `pnpm release <patch|minor|major>`, every item below must be current. Check each one — do not skip.

**Files to verify are in sync:**

| File | What to check |
|---|---|
| `README.md` | CLI reference table, MCP tools table, Analysis capabilities table, Configuration section |
| `AGENTS.md` | MCP tool reference section — all tools, inputs, return shape, when to call |
| `llms.txt` | Quick start commands, MCP tools list (count + names match `src/server/index.ts`) |
| `src/server/index.ts` | Tool descriptions — purpose + when to call + when NOT to call (TDQS criteria) |

**Auto-updated by `pnpm release` — no action needed:**
- `package.json` — version
- `server.json` — version (MCP Registry manifest)
- `docs/architecture.svg` — regenerated from `docs/architecture.mmd` before commit
- Git commit, tag, push, draft GitHub release

**If you change the architecture diagram:** edit `docs/architecture.mmd`, then run `pnpm generate-diagrams` to preview the SVG locally before committing.

**After `pnpm release` — three required steps:**

1. **Publish GitHub release** — go to the draft release on GitHub and publish it → triggers npm CI publish
2. **MCP Registry** — `mcp-publisher publish server.json`
3. **Glama** — admin page → Releases → click Sync → Glama auto-creates the release from the GitHub tag

---

## Releasing to the MCP Registry

After every release, update the MCP registry listing:

```bash
mcp-publisher login github   # first time only
mcp-publisher publish server.json
```

`server.json` is bumped automatically by the release script — just run `publish` after `pnpm release`.

---

## Standing rules

- Follow KISS + SOLID. Simplest shape that works. Complexity must earn its place.
- No comments unless the WHY is non-obvious. No docstrings.
- **Always ask before committing or pushing. Never commit without explicit user approval.**
- Before any commit: run `pnpm lint && pnpm typecheck && pnpm test`. All must pass.
- When adding a new feature (new service type, new adapter, new tool): update `demo/local/app/` with a representative usage example and update `demo/local/infrawise.yaml` if needed. Demo must always stay in sync — no need to be asked.
- **When a new feature adds a config key: update BOTH `src/types.ts` (the TypeScript interface) AND `src/core/config.ts` (the Zod schema).** If only `types.ts` is updated, Zod strips the key silently and the feature never activates — no error, just silent failure. Always add the matching `z.object(...)` entry to `InfrawiseConfigSchema` in `config.ts`.
- **After every implementation, always update all three docs — no exceptions, no need to be asked:**
  - `README.md` — analysis capabilities table, MCP tools table, configuration section, `--severity` flag docs
  - `AGENTS.md` — MCP tool reference section, source layout, recommended usage patterns, expected LocalStack findings count
  - `llms.txt` — tool count, tool list, AWS services description line
- **Version must be in sync everywhere on every release.** `package.json` is the source of truth. `src/server/index.ts` reads it dynamically — no manual update needed there. `server.json` (MCP Registry manifest, committed) is bumped automatically by the release script.

## Running the LocalStack demo

Validates the full adapter stack against real AWS services emulated locally. No AWS account needed.

**Prerequisites:** Docker Desktop running, AWS CLI installed.

```bash
cd demo/localstack
cp .env.example .env        # add your free LocalStack auth token from app.localstack.cloud
./start.sh                  # starts LocalStack + seeds all resources
```

Then in a new terminal from the same directory:

```bash
source .env                 # sets AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test — required every session
infrawise analyze --config infrawise.yaml
```

Expected: 23+ findings across DynamoDB (missing GSI, IaC drift), SQS (missing DLQs), Lambda (128 MB default, 300s timeout), Secrets Manager (rotation disabled), CloudWatch Logs (retention), S3 (missing versioning, verify public access).

To start the MCP server against LocalStack:

```bash
infrawise dev --config infrawise.yaml
```

Stop when done:

```bash
docker compose down
```

**When to run:** After refactoring adapters, adding a new adapter, or changing the analysis pipeline — confirms real extraction + finding generation end-to-end.

---

## MCP tools — keep AGENTS.md current

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
  adapters/
    aws/      extractors (dynamodb, logs, services — SQS/SNS/SSM/Secrets/Lambda/EventBridge/RDS, s3)
    db/       extractors (postgres, mysql, mongodb)
    iac/      extractors (terraform, CDK, CloudFormation — local file parsing)
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

Infrawise exposes 15 tools via `POST http://localhost:3000/mcp` (JSON-RPC 2.0). Start the server with `infrawise dev`.

### `get_infra_overview`

**Start here.** Compact snapshot of everything — counts, all services, high-severity findings.

No inputs required.

Returns: summary counts (tables, functions, queues, topics, secrets, lambdas, buckets), list of databases, services, and buckets, high-severity findings with recommendations.

**When to call:** At the start of any database or infrastructure task to understand what's in scope.

---

### `get_graph_summary`

Full graph: every node, every edge, all findings.

No inputs required.

Returns: all `nodes` (tables, functions, queues, lambdas, etc.), all `edges` (query, scan, publishes_to, etc.), all `findings` with severity/recommendation, summary counts.

**When to call:** When you need the full picture or are tracing relationships across multiple services.

---

### `analyze_function`

Analyze a single function for infrastructure issues, including trigger event shapes.

| Input | Type | Required |
|---|---|---|
| `function` | string | yes |

Returns: file path, all services/tables accessed (with edge types), **triggers** with correct handler event shape (e.g. `event.Records[0].body` for SQS), EventBridge rules fetched on-demand, related findings, deduplicated recommendations.

**When to call:** When writing or reviewing a Lambda handler — always call this first to get the correct event shape for the trigger source. Also use when a function touches a database, queue, or other service.

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

All SNS topics with subscription metadata and filter policies.

No inputs required.

Returns: per-topic — name, provider, subscription count, encryption status, filterPolicies (array of `{ subscriptionArn, protocol, requiredAttributes, scope }`). `requiredAttributes` lists the message attribute keys that subscription's filter policy requires — any publish call missing these attributes will have its message silently dropped by that subscription.

**When to call:** Before writing any SNS publish code to know which message attributes are required. Also when reviewing event fan-out patterns or subscription coverage.

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

All Lambda functions with configuration metadata and event source triggers.

No inputs required.

Returns: per-function — name, runtime, memory (MB), timeout (sec), env var key names (values never included), **triggers** (type, source name, correct handler event shape — includes S3 bucket notifications), findings.

**When to call:** When reviewing Lambda config, checking for default memory (128 MB), high timeouts, or understanding what triggers each function and what event shape to use in the handler. S3-triggered Lambdas show `event.Records[0].s3.object.key` as the event shape.

---

### `get_eventbridge_details`

All EventBridge rules with schedule/event pattern and target functions.

No inputs required.

Returns: per-rule — name, state (ENABLED/DISABLED), scheduleExpression (for rate/cron rules), eventPattern (for event-driven rules), target Lambda function names.

**When to call:** When checking what schedules or events trigger which Lambda functions, or reviewing EventBridge rule coverage.

---

### `get_s3_overview`

All S3 buckets with versioning status, encryption, public access configuration, and security findings.

No inputs required.

Returns: per-bucket — name, provider, versioned (bool), encrypted (bool), publicAccessBlocked (bool), findings.

**When to call:** When checking which S3 buckets exist, reviewing bucket security posture, or before writing S3 upload/delete handlers. Check public access blocked status before assuming bucket contents are private.

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

**Before writing an SNS publish call:**
1. `get_topic_details` → check for filter policies on the target topic
2. Include all `requiredAttributes` as `MessageAttributes` in the publish call — missing any will silently drop the message for that subscription

**Reviewing an entire service:**
1. `get_graph_summary` → full graph
2. Review high-severity findings
3. `analyze_function` for each flagged function

**Infrastructure health check:**
1. `get_infra_overview` → high-severity findings
2. `get_queue_details` → missing DLQs
3. `get_secrets_overview` → rotation disabled
4. `get_lambda_overview` → default memory / high timeout
5. `get_s3_overview` → public access verify, missing versioning/encryption
6. `get_log_errors` → error patterns

## What infrawise never does

- Never reads secret values or parameter values
- Never reads raw log messages
- Never writes to AWS or your database
- Never executes DDL
- No telemetry — everything stays local
