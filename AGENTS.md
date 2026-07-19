# Infrawise — AI instructions

## Project goal

**Genesis pain:** Developers had to copy-paste DynamoDB schemas, RDS table definitions, and Lambda trigger shapes from the AWS console into their AI coding assistant every single session. Manual, repetitive, breaks flow, and still produces wrong code because the pasted context is incomplete.

**What Infrawise is:** The canonical tool for infra-aware AI coding. When a developer thinks "how does my AI assistant know my DynamoDB schema without me pasting it?" — the answer should be Infrawise. The positioning goal is to own the "infra-aware AI coding" category the way Prettier owns formatting or Husky owns git hooks.

**Two product pillars:**

*Context* (developer experience) — AI coding assistants know your live infrastructure. Exact partition keys, sort keys, GSIs, Lambda trigger event shapes, queue DLQ coverage, API routes and their Lambda bindings. The developer never looks at the AWS console mid-coding again. Write correct code the first time because the AI already knows the schema.

*Guard* (mistake prevention) — Surface costly infra mistakes before they ship. Wrong SQS visibility timeout causing duplicate Lambda processing. Missing DLQ silently dropping failed messages. A Lambda scanning a DynamoDB table without a GSI. RDS queries on unindexed columns. These are expensive to discover in production. Infrawise warns at coding time, not incident time.

**What it covers today:**
- AWS: DynamoDB, Lambda, SQS, SNS, SSM Parameter Store, Secrets Manager, EventBridge, RDS, API Gateway, S3, CloudWatch Logs, Cognito, Kinesis, MSK (clusters), ElastiCache, CloudWatch metrics (opt-in runtime signals)
- Databases: PostgreSQL, MySQL, MongoDB
- Messaging: Apache Kafka via `kafkajs` (TS/JS) and kafka-python/confluent-kafka (Python) — broker-agnostic (self-hosted, Confluent, Redpanda, or Amazon MSK). Producer/consumer-to-topic mapping is extracted from application code (AST scan, always-on, no config key) and surfaced as topic nodes via `get_topic_details`. Distinct from the Amazon MSK *Lambda trigger* (detected from the event-source ARN, with event shape `event.records[topic][0].value`).
- IaC: Terraform, CDK, CloudFormation (local file parsing for drift detection, plus stack outputs / cross-stack exports)
- Code scanning: TypeScript/JavaScript (ts-morph) and Python (bundled stdlib-ast scanner run via python3 subprocess, requires python3 on PATH) — auto-detected by file signal, no config. Python detection: boto3 clients and `dynamodb.Table()` resources, `cursor.execute`/SQLAlchemy `text()` SQL, pymongo collections, kafka-python/confluent-kafka

**How it works:** `infrawise analyze` extracts infrastructure into an in-memory graph, runs rule-based analyzers to generate findings, then either prints a report (CLI) or serves 21 MCP tools (server mode) that AI assistants call to get precise context before writing code.

**Strategic bets:**
- MCP is the primary integration surface (Claude Code, Cursor, any MCP-capable editor). `infrawise check` is the standalone CI/CD gate — runs a fresh analysis and exits non-zero when findings reach `--fail-on` severity (default high), reaching teams not yet using AI editors.
- TypeScript/Node is the runtime; the cloud extraction layer is language-agnostic. AST scanning covers TypeScript/JavaScript (ts-morph) and Python (stdlib-ast subprocess); Go and others can follow the same subprocess pattern over time.
- Zero-config fast path is the unlock for adoption. The "aha moment" must happen in under 2 minutes from install — `npx infrawise start` auto-discovers AWS credentials and infra, no infrawise.yaml required. `start` is the entry point; do not add new setup commands (`init`, `doctor`, etc.) that front-load friction.
- The command surface is deliberately five verbs, one per user need: `start` (onboard), `analyze` (full report), `check` (CI gate), `serve` (MCP server — `--stdio` for editors, HTTP by default), `doctor` (diagnostic escape hatch). `stdio` is a hidden backcompat alias for `serve --stdio` (older `.mcp.json` files invoke it). The interactive wizard lives in `src/cli/interactive-setup.ts` (`runInit`), reachable only via `start --interactive`; it is not its own command. Do not re-add `init`, `auth`, or `dev` as commands — their jobs are subsumed by `start`/`serve`.

**Who uses it:** Solo project. One developer (Sidd) is the only contributor. No team conventions apply.

## Pre-release checklist — NO EXCEPTIONS

Before running `pnpm release <patch|minor|major>`, every item below must be current. Check each one — do not skip.

**Files to verify are in sync:**

| File | What to check |
|---|---|
| `README.md` | CLI reference table, MCP tools table, Analysis capabilities table, Configuration section |
| `AGENTS.md` | MCP tool reference section — all tools, inputs, return shape, when to call |
| `llms.txt` | Quick start commands, MCP tools list (count + names match `src/server/index.ts`) |
| `src/server/index.ts` | Tool descriptions — purpose + when to call + when NOT to call (TDQS criteria) |
| `server.json` | Description must stay accurate and must NOT hardcode a tool count (it goes stale on the MCP Registry) |
| `website/src/pages/index.astro` | `softwareVersion` in `SoftwareApplication` JSON-LD schema (hardcoded string, search for `"softwareVersion"`) |

**Auto-updated by `pnpm release` — no action needed:**
- `package.json` — version
- `server.json` — version (MCP Registry manifest)
- `docs/architecture.svg` — regenerated from `docs/architecture.yml` before commit
- Git commit, tag, push, draft GitHub release

**If you change the architecture diagram:**
1. Edit `docs/architecture.yml` — the single source of truth for all diagram variants
2. Run `pnpm build-arch` — generates two outputs:
   - `docs/architecture.svg` — static SVG for the GitHub README
   - `website/public/arch-web.svg` — inlined by the website's `ArchDiagram.astro` component
3. The website diagram automatically gets flowing-light edge animations and `font-family` from the page; no extra steps needed
4. Commit both generated SVG files alongside your YAML change

**After `pnpm release` — four required steps:**

1. **Publish GitHub release** — go to the draft release on GitHub and publish it → triggers npm CI publish
2. **MCP Registry** — `mcp-publisher publish server.json`
3. **Glama** — admin page → Releases → click Sync → Glama auto-creates the release from the GitHub tag
4. **Smithery** — `pnpm publish-smithery` (after the npm publish from step 1 is live — the script verifies this and fails otherwise). Rebuilds the MCPB bundle from the published npm package, regenerates the serverCard from the live `tools/list`, and publishes to https://smithery.ai/server/pandeysiddharth27/infrawise. Smithery has no scan stage for stdio bundles, so a stale serverCard means stale tools on the page — always rerun after a release that touches tools. Auth: `npx @smithery/cli auth login` (once) or `SMITHERY_TOKEN` env var.

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
- **NO source code changes for LocalStack — period.** `src/` is written for real AWS only. LocalStack is reached through a standard `localstack` AWS profile the user adds to their global `~/.aws/config` + `~/.aws/credentials` (with `endpoint_url = http://localhost:4566` + `test`/`test` creds). The demo's `infrawise.yaml` uses `profile: localstack` and `.env` sets `AWS_PROFILE=localstack`; the AWS SDK resolves credentials, region, and `endpoint_url` from that profile. infrawise just selects a profile like any other. Never add an `endpoint` config key, dummy credentials, port-4566 probe, or any `localstack`/`4566` reference to `src/`. Setup is documented in `demo/localstack/README.md`.
- **Always ask before committing or pushing. Never commit without explicit user approval.**
- Do NOT manually run `pnpm format`/`lint`/`typecheck`/`test` just before a commit — the `pre-commit` hook runs all four automatically (and re-stages only the files already in the commit after prettier). Running them by hand right before committing is wasted work; if the hook fails, fix and re-commit. Run them during development whenever you want to validate a change in progress.
- When adding a new feature (new service type, new adapter, new tool): update `demo/local/app/` with a representative usage example and update `demo/local/infrawise.yaml` if needed. Demo must always stay in sync — no need to be asked.
- **When a new feature adds a config key: update BOTH `src/types.ts` (the TypeScript interface) AND `src/core/config.ts` (the Zod schema).** If only `types.ts` is updated, Zod strips the key silently and the feature never activates — no error, just silent failure. Always add the matching `z.object(...)` entry to `InfrawiseConfigSchema` in `config.ts`.
- **After every implementation, always update all three docs — no exceptions, no need to be asked:**
  - `README.md` — CLI reference table (including `start` flags), MCP tools table, "Using with AI coding assistants" section, configuration section, `--severity` flag docs
  - `AGENTS.md` — MCP tool reference section, source layout, recommended usage patterns, expected LocalStack findings count
  - `llms.txt` — quick start commands, tool count, tool list, AWS services description line
- **Version must be in sync everywhere on every release.** `package.json` is the source of truth. `src/server/index.ts` reads it dynamically — no manual update needed there. `server.json` (MCP Registry manifest, committed) is bumped automatically by the release script.

## Running the LocalStack demo

Validates the full adapter stack against real AWS services emulated locally. No AWS account needed.

**Prerequisites:** Docker Desktop running, AWS CLI installed, and a `localstack` AWS profile in `~/.aws` (one-time setup — see `demo/localstack/README.md`).

```bash
cd demo/localstack
cp .env.example .env        # add your free LocalStack auth token from app.localstack.cloud
./start.sh                  # starts LocalStack + seeds all resources
```

Then in a new terminal from the same directory:

```bash
source .env                 # sets AWS_PROFILE=localstack — required every session
infrawise analyze --config infrawise.yaml
```

Expected: 35+ findings across DynamoDB (missing GSI, IaC drift), SQS (missing DLQs, visibility timeout mismatch), Lambda (128 MB default, 300s timeout), Secrets Manager (rotation disabled), CloudWatch Logs (retention), S3 (missing versioning, verify public access), API Gateway (1 API, 4 routes extracted). Against Floci (see demo README) Cognito (1 user pool), Kinesis (1 stream), and ElastiCache (1 cluster, transit encryption finding) also extract — 38 findings total. Note: Kinesis-triggered Lambdas no longer produce the SQS-style missing-DLQ finding (kinesis trigger sources are now stream nodes, not queue placeholders).

To start the MCP server against LocalStack:

```bash
infrawise serve --config infrawise.yaml    # HTTP transport, keeps server running in foreground
# or for stdio-based editors:
infrawise start --config infrawise.yaml    # writes .mcp.json, then open your editor
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
    aws/      extractors (dynamodb, logs, services — SQS/SNS/SSM/Secrets/Lambda/EventBridge/RDS/APIGateway/Cognito/Kinesis/MSK/ElastiCache, s3, metrics — CloudWatch runtime signals)
    db/       extractors (postgres, mysql, mongodb)
    iac/      extractors (terraform, CDK, CloudFormation — local file parsing)
  analyzers/  rule-based analyzers
  context/    AST scanners (ts-morph for TS/JS, scanner.py subprocess for Python)
  server/     Fastify MCP server (@modelcontextprotocol/sdk, Streamable HTTP)
  cli/        CLI commands
```

Build: `pnpm build` → `tsc --noEmit false --outDir dist`
Typecheck: `pnpm typecheck` → `tsc`
Test: `pnpm test` → vitest

---

## MCP tool reference

Infrawise exposes 21 tools via MCP. Run `infrawise start` to analyze and write `.mcp.json` — your editor manages the server from there. For HTTP transport: `infrawise serve` starts the server at `POST http://localhost:3000/mcp`.

### `get_infra_overview`

**Start here.** Compact snapshot of everything — counts, all services, high-severity findings.

No inputs required.

Returns: summary counts (tables, functions, queues, topics, secrets, lambdas, buckets), list of databases, services, and buckets, high-severity findings with recommendations, a `freshness` object, and a `configured` flag. `freshness` reports `analyzedAt` (ISO timestamp of the loaded analysis), `ageSeconds`, and a `stale` flag (true once the analysis is older than 24h) with a `hint` to run `infrawise analyze`; all three are null/false when serving an empty graph. When `configured` is false the server booted without an infrawise.yaml (e.g. a remotely hosted instance with no access to your cloud account or code) so every tool returns empty results; a `setupHint` then explains how to run infrawise locally.

**When to call:** At the start of any database or infrastructure task to understand what's in scope.

---

### `get_graph_summary`

Full graph: every node, every edge, all findings.

No inputs required.

Returns: all `nodes` (tables, functions, queues, lambdas, etc.), all `edges` (query, scan, publishes_to, etc.), all `findings` with severity/recommendation, summary counts.

**When to call:** When you need the full picture or are tracing relationships across multiple services.

---

### `get_table_schema`

Column-level schema for specific tables or collections, on demand. **Row data is never included.**

| Input | Type | Required |
|---|---|---|
| `tables` | string[] (1-20) | yes |

Returns: per requested name — `found` flag, and `matches` (short names like "orders" match "public.orders", case-insensitive; a name can match tables in multiple databases). Each match: databaseType, columns (name, dataType, nullable), primaryKeys, foreignKeys (column → referencesTable.referencesColumn — join paths), indexes, DynamoDB partitionKey/sortKey, MongoDB estimatedCount. Unknown names return up to 5 `suggestions`.

**When to call:** After `get_infra_overview`, when you need column-level detail to write a SQL query, DynamoDB expression, or MongoDB filter for specific tables. This is the progressive-disclosure path for large databases — fetch only the schemas you need instead of dumping everything with `get_graph_summary`.

---

### `analyze_function`

Analyze a single function for infrastructure issues, including trigger event shapes.

| Input | Type | Required |
|---|---|---|
| `function` | string | yes |

Returns: file path, all services/tables accessed (with edge types), **triggers** with correct handler event shape (e.g. `event.Records[0].body` for SQS), EventBridge rule name and event pattern when the trigger is EventBridge, **missingPermissions** (list of AWS service names the function accesses in code but the execution role does not allow — present only when IAM data is available), related findings, deduplicated recommendations.

**When to call:** When writing or reviewing a Lambda handler — always call this first to get the correct event shape for the trigger source, confirm IAM permissions cover the services the function calls, and get all findings scoped to this function. Also use when a function touches a database, queue, or other service.

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

Returns: per-queue — name, provider, DLQ status, encryption, isFifo (bool), visibilityTimeoutSec, approximate message count, retention days, oldestMessageAgeSec (only when runtime signals are enabled), findings.

**When to call:** When reviewing messaging architecture, debugging backlogs, checking DLQ coverage, or verifying that the queue's visibility timeout is at least 6× the consumer Lambda's timeout (mismatches cause duplicate processing). When `isFifo` is true, all `SendMessage` calls must include a `MessageGroupId` — omitting it causes a runtime error.

---

### `get_topic_details`

All SNS topics with subscription metadata and filter policies.

No inputs required.

Returns: per-topic — name, provider, subscription count, encryption status, filterPolicies (array of `{ subscriptionArn, protocol, requiredAttributes, scope }`). `requiredAttributes` lists the message attribute keys that subscription's filter policy requires — any publish call missing these attributes will have its message silently dropped by that subscription.

**When to call:** Before writing any SNS publish code to know which message attributes are required. Also when reviewing event fan-out patterns or subscription coverage.

---

### `get_secrets_overview`

All Secrets Manager secrets — names, rotation status, and key names inferred from application code. **Values are never included** — infrawise never calls `GetSecretValue`; key names come from static analysis of code that parses the secret (e.g. `JSON.parse(res.SecretString).password` or `json.loads(response['SecretString'])['password']`), not from AWS.

No inputs required.

Returns: per-secret — name, provider, rotation enabled, rotation interval days, `referencedKeys` (key names accessed in code, `[]` if none detected), findings.

**When to call:** When checking which secrets exist, whether rotation is configured, or before writing code that reads a secret — use `referencedKeys` to get the exact key name instead of guessing `secret.password` vs `secret.passwd`.

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

Returns: per-function — name, runtime, memory (MB), timeout (sec), env var key names (values never included), **roleArn** (execution role ARN), **triggers** (type, source name, correct handler event shape — includes S3 bucket notifications), recentThrottles/recentErrors (only when runtime signals are enabled), findings.

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

### `get_api_routes`

All API Gateway APIs (REST, HTTP, WebSocket) with their routes and Lambda integrations.

No inputs required.

Returns: per-API — name, type (REST/HTTP/WEBSOCKET), routes (method, path, lambda name). Lambda name is null when the route has no Lambda integration.

**When to call:** Before writing any API handler to confirm which Lambda backs a route, or when reviewing API surface area. Also use to check for routes with no Lambda integration (null lambda) that may need wiring.

---

### `get_log_errors`

Recent error patterns from CloudWatch log groups. **Raw log messages are never included.**

| Input | Type | Required |
|---|---|---|
| `logGroup` | string | no — filters by name substring |

Returns: per-log-group — name, retention days, error count, top error patterns with frequency.

**When to call:** When investigating errors or checking which log groups have no retention policy.

---

### `get_stack_outputs`

Stack outputs and cross-stack exports parsed from local IaC files.

No inputs required.

Returns: per-output — name, description, exportName (CFN/CDK `Export.Name`), raw value expression, source (terraform/cloudformation/cdk), file path.

**When to call:** When wiring cross-stack references (`Fn::ImportValue`, `terraform_remote_state`) or when you need the exported name of a resource defined in another stack. Not for live resource attributes — outputs come from local IaC files, not the deployed stack.

---

### `get_cognito_overview`

All Cognito user pools with app client configuration. **Client secret values and user data are never included.**

No inputs required.

Returns: per-pool — name, id, mfaConfiguration, clients (clientName, clientId, authFlows, oauthFlows, oauthScopes, callbackUrls, generatesSecret, token validity + units).

**When to call:** Before writing any Cognito sign-in, sign-up, or token-refresh code — use an allowed auth flow, and send `SECRET_HASH` when `generatesSecret` is true.

---

### `get_stream_details`

All Kinesis data streams and Amazon MSK clusters.

No inputs required.

Returns: streams (name, status, shardCount, retentionHours, encrypted, mode PROVISIONED/ON_DEMAND) and kafkaClusters (name, state, clusterType, kafkaVersion, brokerNodes).

**When to call:** When writing Kinesis producer/consumer code, checking capacity mode before PutRecord calls, or reviewing streaming architecture. For Kafka topic-level producer/consumer mappings from application code, use `get_topic_details` instead.

---

### `get_cache_overview`

All ElastiCache clusters. **Cached data is never read or included.**

No inputs required.

Returns: per-cluster — id, engine, engineVersion, nodeType, numNodes, transitEncryption, atRestEncryption, replicationGroupId, automaticFailover, findings.

**When to call:** Before writing cache client code (TLS required when transit encryption is on — `rediss://` for Redis) or when reviewing cache availability and security posture.

---

## Recommended usage patterns

**Before writing a query:**
1. `get_infra_overview` → understand what tables/services exist
2. `analyze_function` on the relevant function → check existing patterns
3. `suggest_gsi` or `postgres_index_suggestions` if an index is needed

**Before writing an SNS publish call:**
1. `get_topic_details` → check for filter policies on the target topic
2. Include all `requiredAttributes` as `MessageAttributes` in the publish call — missing any will silently drop the message for that subscription

**Text-to-SQL / query-writing agents (large databases):**
1. `get_infra_overview` once per session → compact table inventory (names + database type); it also reports analysis freshness with a 24h stale flag
2. When the task needs specific tables: `get_table_schema` with just those names → columns, types, PKs, FKs for joins
3. Never dump the full schema into the prompt — `get_graph_summary` is the escape hatch, not the default

**Before writing Cognito auth code:**
1. `get_cognito_overview` → check the app client's allowed auth flows
2. Use one of the allowed flows; include `SECRET_HASH` when `generatesSecret` is true

**Reviewing an entire service:**
1. `get_graph_summary` → full graph
2. Review high-severity findings
3. `analyze_function` for each flagged function

**Infrastructure health check:**
1. `get_infra_overview` → high-severity findings
2. `get_queue_details` → missing DLQs, visibility timeout mismatches
3. `get_secrets_overview` → rotation disabled
4. `get_lambda_overview` → default memory / high timeout
5. `get_s3_overview` → public access verify, missing versioning/encryption
6. `get_api_routes` → route-to-Lambda coverage
7. `get_log_errors` → error patterns

## What infrawise never does

- Never reads secret values or parameter values
- Never reads Cognito user data or client secret values
- Never reads cached data from ElastiCache
- Never reads raw log messages
- Never writes to AWS or your database
- Never executes DDL
- No telemetry — everything stays local
