# Infrawise

[![npm version](https://img.shields.io/npm/v/infrawise)](https://www.npmjs.com/package/infrawise)
[![Publish to npm](https://github.com/Sidd27/infrawise/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/Sidd27/infrawise/actions/workflows/npm-publish.yml)
[![CI](https://github.com/Sidd27/infrawise/actions/workflows/ci.yml/badge.svg)](https://github.com/Sidd27/infrawise/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![infrawise MCP server](https://glama.ai/mcp/servers/Sidd27/infrawise/badges/score.svg)](https://glama.ai/mcp/servers/Sidd27/infrawise)

**[sidd27.github.io/infrawise](https://sidd27.github.io/infrawise/) — Understand your infrastructure, not just your code.**

Infrawise gives AI coding assistants deterministic infrastructure awareness.

It statically analyzes your codebase, cloud infrastructure, and database schemas, then exposes that context through MCP so tools like Claude Code can understand your actual tables, indexes, query patterns, and service relationships instead of guessing from source files alone.

![infrawise start --claude, then Claude Code answers an SQS handler question with the exact event shape and queue risks pulled live from infrawise](https://raw.githubusercontent.com/Sidd27/infrawise/main/docs/demo/gifs/mcp.gif)

---

## Why this exists

New software developers don't write wrong code. Claude Code writes wrong code and they ship it. Infrawise is the only thing standing between Claude Code's generated output and a production incident.

AI coding assistants can read your source files but have no deterministic knowledge of your infrastructure. They do not know which GSIs exist, how tables are partitioned, which functions already trigger scans, or where indexes are missing. So they guess.

Infrawise replaces guessing with infrastructure-aware context.

**Without Infrawise**, an AI assistant might:

- Suggest a `.scan()` on your Orders table that has 50M rows
- Recommend adding a GSI on `status` that you already have
- Write a `SELECT *` when you need to keep query cost low
- Not notice that 5 functions are already hammering the same partition key

**With Infrawise**, it knows:

- Your exact table schemas, partition keys, sort keys, and GSIs
- Which functions query which tables and how
- Which patterns are already flagged as high severity
- The exact `CREATE INDEX` SQL or GSI config for your tables — not generic advice

---

## What Infrawise is not

Infrawise is not an AI agent framework, an infrastructure provisioning tool, an observability platform, or a cloud management dashboard.

It is a deterministic infrastructure intelligence layer for AI-assisted development.

---

## Installation

```bash
npm install -g infrawise
```

or use without installing:

```bash
npx infrawise start --claude
```

---

## Quick start

```bash
cd your-project
infrawise start --claude
```

That's it. Infrawise will:

1. Probe your environment and generate `infrawise.yaml` (first time only — asks which AWS profile to use only if you have several)
2. Scan your AWS services, databases, and codebase
3. Write `.mcp.json` so your editor auto-connects on every future launch
4. Open Claude Code with all 21 MCP tools ready

**Every time after:**

```bash
claude    # no infrawise command needed — editor manages the connection
```

Analysis is cached for 24 hours. When the cache is stale, `infrawise serve --stdio` (spawned automatically by your editor) refreshes it at session start. File changes are detected within the session and the code graph is updated automatically.

```
Findings (3 total)

1. [HIGH] Full table scan detected on DynamoDB table "Orders"
   listAllOrders() scans without any filter — reads every item in the table.
   Recommendation: Replace Scan with Query using a partition key or add a GSI.

2. [MEDIUM] PostgreSQL table "users" has no index on column "email"
   Filtering on "email" causes sequential scans.
   Recommendation: CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

3. [MEDIUM] DynamoDB table "Sessions" accessed by 6 distinct code paths
   High access concentration may create hot partition issues at scale.
```

---

## Using with AI coding assistants

### Claude Code (recommended)

```bash
infrawise start --claude
```

Writes `.mcp.json` to your project root and opens Claude Code. Claude Code reads `.mcp.json` automatically on every launch and manages the `infrawise serve --stdio` process — no server to start, no ports to configure.

### Cursor

```bash
infrawise start --cursor
```

Writes `.cursor/mcp.json` and opens Cursor. All 21 infrawise tools are available in Cursor's MCP panel.

### Any editor (no flag)

```bash
infrawise start
```

Writes `.mcp.json` and exits. Open whichever editor you prefer — point it at `infrawise serve --stdio --config /path/to/infrawise.yaml` as an MCP server command.

### HTTP transport (alternative)

If your editor or workflow requires an HTTP MCP endpoint instead of stdio:

```bash
infrawise serve    # starts server at http://localhost:3000/mcp
```

Add to your editor's MCP config:

```json
{
  "mcpServers": {
    "infrawise": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### MCP tools

| Tool                         | What it provides                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `get_infra_overview`         | Complete snapshot — services, counts, high-severity findings, analysis `freshness` (age + stale flag), `configured` flag |
| `get_graph_summary`          | Full infrastructure graph — all nodes, edges, and findings                                                  |
| `get_table_schema`           | Column-level schema for named tables/collections — types, PKs, FKs, indexes, DynamoDB keys (no row data)    |
| `analyze_function`           | Issues in a specific function — scans, missing indexes, N+1, trigger event shapes, missing IAM permissions  |
| `suggest_gsi`                | Exact GSI config for a DynamoDB table + attribute                                                           |
| `postgres_index_suggestions` | Exact `CREATE INDEX` SQL for your actual table                                                              |
| `suggest_mongo_index`        | Exact `createIndex` command for a MongoDB collection + field                                                |
| `mysql_index_suggestions`    | Exact `ALTER TABLE ADD INDEX` SQL for your MySQL table                                                      |
| `get_queue_details`          | SQS queues — DLQ status, encryption, FIFO type, visibility timeout, message counts                          |
| `get_api_routes`             | API Gateway APIs (REST, HTTP, WebSocket) — routes, HTTP methods, paths, and Lambda integrations             |
| `get_topic_details`          | SNS topics — subscription counts, protocols, and filter policies (required message attributes per subscription) |
| `get_secrets_overview`       | Secrets Manager — names and rotation status (values never included)                                         |
| `get_parameter_overview`     | SSM Parameter Store — names, types, tiers (values never included)                                           |
| `get_lambda_overview`        | Lambda functions — runtime, memory, timeout, execution role ARN, triggers (SQS/SNS/DynamoDB/Kinesis/MSK/EventBridge/S3), env var key names |
| `get_eventbridge_details`    | EventBridge rules — name, state, schedule/event pattern, target functions                                   |
| `get_s3_overview`            | S3 buckets — versioning, encryption, public access, event notifications                                     |
| `get_log_errors`             | CloudWatch error patterns and counts (no raw log messages)                                                  |
| `get_stack_outputs`          | Stack outputs and cross-stack exports parsed from local IaC files (Terraform outputs, CFN/CDK Outputs)      |
| `get_cognito_overview`       | Cognito user pools — MFA config, app client auth flows, OAuth settings, token validity (secrets never included) |
| `get_stream_details`         | Kinesis streams (shards, retention, capacity mode) and MSK clusters (state, Kafka version, brokers)          |
| `get_cache_overview`         | ElastiCache clusters — engine, encryption in transit/at rest, replication group, failover (data never read)  |

---

## CLI reference

| Command                       | What it does                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `infrawise start`             | **Primary command** — probe env, generate config, analyze, write editor MCP config |
| `infrawise start --claude`    | Same as above, then opens Claude Code                                             |
| `infrawise start --cursor`    | Same as above, then opens Cursor                                                  |
| `infrawise start --interactive` | Run the guided setup wizard instead of auto-discovery                           |
| `infrawise start --rediscover` | Delete `infrawise.yaml` + `.infrawise/`, then re-probe and re-analyze            |
| `infrawise analyze`           | Force a full re-scan — useful after major infrastructure changes                  |
| `infrawise check`             | CI gate — analyze and exit non-zero when findings reach the threshold severity    |
| `infrawise serve`             | Start the MCP server — HTTP by default, or `--stdio` for editor integration       |
| `infrawise doctor`            | Diagnostic escape hatch — validate AWS/DB access, config, and repo scan            |

### `infrawise analyze` options

| Flag                  | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `-c, --config <path>` | Path to `infrawise.yaml` (default: `infrawise.yaml`)                   |
| `-r, --repo <path>`   | Repository to scan (default: current directory)                        |
| `--no-cache`          | Skip reading/writing the cache                                         |
| `-o, --output <path>` | Save findings as a markdown report, e.g. `report.md`                   |
| `--severity <level>`  | Only show findings at or above this level: `high` \| `medium` \| `low` |

```bash
# Export a shareable findings report
infrawise analyze --output report.md

# Only show high-severity issues
infrawise analyze --severity high

# High-severity issues only, saved to a file
infrawise analyze --severity high --output report.md
```

### `infrawise check` options (CI/CD)

`check` runs a fresh analysis and sets a non-zero exit code when blocking findings exist, so it can gate a pipeline without an AI editor.

| Flag                  | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `-c, --config <path>` | Path to `infrawise.yaml` (default: `infrawise.yaml`)                   |
| `-r, --repo <path>`   | Repository to scan (default: current directory)                        |
| `--fail-on <level>`   | Severity that fails the build: `high` (default) \| `medium` \| `low`   |

```bash
# Block a deploy if any high-severity finding exists (exit 1)
infrawise check

# Stricter gate — fail on medium and above
infrawise check --fail-on medium
```

### `infrawise serve` options

| Flag                  | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `-c, --config <path>` | Path to `infrawise.yaml` (default: `infrawise.yaml`)                   |
| `--stdio`             | Use stdio transport (for editors via `.mcp.json`) instead of HTTP      |
| `-p, --port <number>` | Port to listen on, HTTP only (default: `3000`)                         |

---

## Configuration

`infrawise.yaml` is generated by `infrawise start` (or `infrawise start --interactive` for the guided wizard) and lives in your repo root. Every service must be explicitly `enabled: true` — infrawise never connects to anything not listed in config.

Connection strings support `${ENV_VAR}` substitution so passwords never need to be committed:

```yaml
postgres:
  enabled: true
  connectionString: postgresql://infrawise_ro:${DB_PASSWORD}@host:5432/mydb
```

Full example:

```yaml
project: payments-service

aws:
  profile: default # AWS profile from ~/.aws/credentials
  region: ap-south-1

dynamodb:
  enabled: true
  includeTables: # omit to include all tables
    - Orders
    - Users

postgres:
  enabled: true
  connectionString: postgresql://infrawise_ro:${DB_PASSWORD}@host:5432/mydb

mysql:
  enabled: false
  connectionString: ''

mongodb:
  enabled: false
  connectionString: ''

sqs:
  enabled: true

sns:
  enabled: true

ssm:
  enabled: true
  paths: [] # filter by prefix e.g. ["/myapp/prod"]

secretsManager:
  enabled: true

lambda:
  enabled: true
  includeFunctions: # omit to include all functions
    - myFunction
    - anotherFunction

eventbridge:
  enabled: true

rds:
  enabled: false

s3:
  enabled: false

apiGateway:
  enabled: false

cognito:
  enabled: false

kinesis:
  enabled: false

msk:
  enabled: false

elasticache:
  enabled: false

runtimeSignals:
  enabled: false # Lambda throttles/errors + queue age via CloudWatch metrics
  windowHours: 24

cloudwatchLogs:
  enabled: false
  logGroupPrefixes: []
  windowHours: 24

analysis:
  sampleSize: 100
  hotPartitionThreshold: 5
  hotPartitionThresholds:
    high-traffic-table: 12
```

### AWS setup

Infrawise is **read-only**. Minimum IAM policy required:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:ListTables", "dynamodb:DescribeTable"],
      "Resource": "*"
    }
  ]
}
```

For SSO profiles, log in before running infrawise:

```bash
aws sso login --profile myprofile
```

### PostgreSQL setup (optional)

Create a read-only user for infrawise:

```sql
CREATE USER infrawise_ro WITH PASSWORD 'yourpassword';
GRANT CONNECT ON DATABASE yourdb TO infrawise_ro;
GRANT USAGE ON SCHEMA public TO infrawise_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO infrawise_ro;
```

For Amazon RDS: allow inbound on port 5432 from your machine's IP in the security group.

---

## Analysis capabilities

Infrawise has two analysis layers:

### Infrastructure analysis (all languages)

Works from AWS APIs, database schema introspection, and IaC files — no dependency on application code:

| Service                          | What it checks                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| DynamoDB schema                  | Tables, GSIs, partition keys                                                                                       |
| PostgreSQL / MySQL schema        | Tables, indexes, column types                                                                                      |
| MongoDB schema                   | Collections, indexes                                                                                               |
| SQS                              | Missing DLQs, unencrypted queues, large backlogs, FIFO detection, visibility timeout vs Lambda timeout mismatch    |
| SNS                              | Subscription filter policies — required message attributes per subscription                                        |
| Apache Kafka (kafkajs)           | Producer/consumer topic mapping from code — any broker (self-hosted, Confluent, Redpanda, MSK); distinct from the MSK Lambda trigger |
| Secrets Manager                  | Missing secret rotation                                                                                            |
| Lambda                           | Default memory (128 MB), high timeouts, triggers (SQS/SNS/DynamoDB/Kinesis/MSK/EventBridge/S3), missing DLQ on trigger source |
| S3                               | Public access blocking (verify), missing versioning, missing encryption                                            |
| EventBridge                      | Rules, schedules, event patterns, target Lambda functions                                                          |
| API Gateway                      | REST, HTTP, and WebSocket APIs — routes, methods, Lambda integrations                                             |
| RDS                              | Publicly accessible, no backups, unencrypted, no deletion protection, single-AZ                                    |
| CloudWatch Logs                  | Log groups with no retention policy                                                                                |
| Cognito                          | User pools and app client config — auth flows, OAuth settings, token validity, client secret presence              |
| Kinesis / MSK                    | Streams (shards, retention, capacity mode) and MSK clusters (state, Kafka version, brokers)                        |
| ElastiCache                      | Missing in-transit encryption, single-node clusters with no replication                                            |
| Runtime signals (opt-in)         | Lambda throttling/errors and stale queue messages from CloudWatch metrics                                          |
| Terraform / CloudFormation / CDK | IaC drift vs deployed state; stack outputs and cross-stack exports                                                 |

### Code correlation analysis (TypeScript / JavaScript)

Uses [ts-morph](https://ts-morph.com/) AST analysis to detect which functions call which tables and how:

| Analyzer                   | Severity | What it detects                               |
| -------------------------- | -------- | --------------------------------------------- |
| Full Table Scan (DynamoDB) | High     | `.scan()` calls without filters               |
| Missing GSI                | Medium   | Queries on attributes without a matching GSI  |
| Hot Partition              | Medium   | 5+ distinct code paths hitting the same table |
| Missing Index (PostgreSQL) | Medium   | Tables queried without indexes                |
| N+1 Query                  | High     | Repeated query patterns from ORM loops        |
| Large SELECT               | Low      | `SELECT *` usage                              |
| Missing MySQL Index        | Medium   | MySQL tables queried without indexes          |
| MySQL Full Table Scan      | High     | Full table scan patterns in MySQL queries     |
| Missing Mongo Index        | Medium   | Collections queried without secondary indexes |
| Collection Scan            | High     | `find()` calls without filter predicates      |
| Pipeline: scan in consumer | High / Verify | Full scan inside an event-triggered Lambda handler (High when the lambda-to-code link is IaC-proven, Verify when name-matched) |
| Pipeline: repeated table access | Medium / Verify | Same table read by 2+ functions in one service pipeline |
| Pipeline: missing DLQ hop  | Medium   | Mid-pipeline queue (has producer and consumer) with no Dead Letter Queue |

Non-TypeScript/JavaScript projects still get full value from infrastructure-level analyzers — code correlation (function-to-table mapping, N+1 patterns) is skipped.

The scanner supports: AWS SDK v3/v2 for DynamoDB, `pg`/Prisma/Knex for PostgreSQL, `mysql2`/Knex for MySQL, driver/Mongoose for MongoDB, AWS SDK v3 for SQS/SNS/SSM/Secrets/Lambda, and `kafkajs` for Kafka topics (producer/consumer).

---

## How it works

1. Infrawise scans your repository and infrastructure metadata
2. A graph engine maps services, schemas, indexes, and query patterns
3. Rule-based analyzers detect infrastructure and query anti-patterns
4. The resulting context is exposed through MCP
5. AI coding assistants query this context while generating code

---

## Deterministic analysis

Infrawise does not use an LLM to analyze your infrastructure. All extraction and analysis are deterministic: AST parsing, schema introspection, rule-based analyzers, and graph correlation. LLMs are only consumers of the generated context through MCP.

---

## Security

- **Read-only** — never writes to AWS or your database, never executes DDL
- **Local-first** — everything runs on your machine, nothing sent to external servers
- **No telemetry** — zero data collection
- **Credentials** — uses your existing AWS credential chain, never stored by infrawise

### 🔒 Security & Project Naming Note

You might see this package flagged on certain supply-chain security scanners under "deceptive naming." This is a false positive triggered by automated tools because of the prefix "infra." This project is completely safe, independent, and unaffiliated with any commercial trademarks.

---

## Architecture overview

![Architecture](./docs/architecture.svg)

### Source layout

```
src/
  types.ts      Shared type definitions
  core/         Config (Zod + YAML), logger (Pino), local cache
  graph/        Graph engine — nodes, edges, builder
  adapters/
    aws/        DynamoDB, S3, Lambda, SQS/SNS/SSM/Secrets/EventBridge/RDS/APIGateway, CloudWatch
    db/         PostgreSQL, MySQL, MongoDB
    iac/        Terraform, CDK, CloudFormation (local file parsing)
  analyzers/    34 rule-based analyzers
  context/      Repository scanner (ts-morph AST)
  server/       Fastify MCP server (@modelcontextprotocol/sdk, Streamable HTTP)
  cli/          CLI commands (Commander.js)
```

---

## Current limitations

- Code-level correlation supports TypeScript and JavaScript only
- Dynamically constructed queries may not always be resolved statically
- Runtime tracing is not yet implemented
- Large monorepos may require future incremental analysis optimization

---

## Roadmap

Feature roadmap is tracked in the [GitHub Project](https://github.com/users/Sidd27/projects/1). Feature requests and upvotes welcome.

---

## Demo

The `demo/localstack/` directory runs infrawise against real AWS APIs emulated locally via [LocalStack](https://localstack.cloud) — an open-source tool that spins up a full AWS environment in Docker so you can test AWS integrations at zero cost, with no real AWS account needed. See [`demo/localstack/README.md`](demo/localstack/README.md) for setup instructions.

![infrawise analyze running against the LocalStack demo and reporting the high-severity findings](https://raw.githubusercontent.com/Sidd27/infrawise/main/docs/demo/gifs/analyze.gif)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for a full walkthrough — including how to add a new service adapter, a new analyzer, and the PR checklist.

### Releasing

```bash
pnpm release patch    # 0.1.2 → 0.1.3  (bug fixes)
pnpm release minor    # 0.1.2 → 0.2.0  (new features, backwards compatible)
pnpm release major    # 0.1.2 → 1.0.0  (breaking changes)
pnpm release 1.5.0    # explicit version
```

Bumps `package.json`, commits, tags, pushes, and creates a draft GitHub release with notes from commit messages. Then publish the draft on GitHub to trigger npm publish.

---

## License

MIT
