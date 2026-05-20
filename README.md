# Infrawise

[![npm version](https://img.shields.io/npm/v/infrawise)](https://www.npmjs.com/package/infrawise)
[![Publish to npm](https://github.com/Sidd27/infrawise/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/Sidd27/infrawise/actions/workflows/npm-publish.yml)
[![CI](https://github.com/Sidd27/infrawise/actions/workflows/ci.yml/badge.svg)](https://github.com/Sidd27/infrawise/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Understand your infrastructure, not just your code.**

Infrawise gives AI coding assistants deterministic infrastructure awareness.

It statically analyzes your codebase, cloud infrastructure, and database schemas, then exposes that context through MCP so tools like Claude Code can understand your actual tables, indexes, query patterns, and service relationships instead of guessing from source files alone.

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
npx infrawise init
```

---

## Quick start

**1. Initialize in your repo**

```bash
cd your-project
infrawise init
```

Detects your AWS profile and region, asks a few questions, writes `infrawise.yaml`. That's the only file it creates in your project.

**2. Validate everything is connected**

```bash
infrawise doctor
```

**3. Run analysis**

```bash
infrawise analyze
```

Or skip this step — `infrawise dev` auto-runs analysis if no cache exists.

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

### Step 1: Start the MCP server

```bash
infrawise dev
```

```
  ✔ Config loaded          infrawise.yaml
  ✔ Cached analysis loaded 42 nodes · 18 edges · 7 finding(s)
  ✔ Server running

  ┌────────────────────────────────────────────────────┐
  │ MCP Server                                        │
  ├────────────────────────────────────────────────────┤
  │ POST http://localhost:3000/mcp                    │
  │ GET  http://localhost:3000/health                 │
  ├────────────────────────────────────────────────────┤
  │ Tools (13 active)                                 │
  │ get_infra_overview · get_graph_summary            │
  │ ...                                               │
  └────────────────────────────────────────────────────┘

  Watching for file changes... Press Ctrl+C to stop
```

### Step 2: Add to your editor settings

**Claude Code** — edit `.claude/settings.json` in your repo (project-level) or `~/.claude/settings.json` (global):

```json
{
  "mcpServers": {
    "infrawise": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

To let Claude Code manage the server lifecycle automatically:

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

**Cursor** and **Windsurf** — add `http://localhost:3000/mcp` as an MCP server in editor settings.

### MCP tools

| Tool | What it provides |
|---|---|
| `get_infra_overview` | Complete snapshot — all services, counts, and high-severity findings |
| `get_graph_summary` | Full infrastructure graph — all nodes, edges, and findings |
| `analyze_function` | Issues in a specific function — scans, missing indexes, N+1 |
| `suggest_gsi` | Exact GSI config for a DynamoDB table + attribute |
| `postgres_index_suggestions` | Exact `CREATE INDEX` SQL for your actual table |
| `suggest_mongo_index` | Exact `createIndex` command for a MongoDB collection + field |
| `mysql_index_suggestions` | Exact `ALTER TABLE ADD INDEX` SQL for your MySQL table |
| `get_queue_details` | SQS queues — DLQ status, encryption, message counts |
| `get_topic_details` | SNS topics — subscription counts and protocols |
| `get_secrets_overview` | Secrets Manager — names and rotation status (values never included) |
| `get_parameter_overview` | SSM Parameter Store — names, types, tiers (values never included) |
| `get_lambda_overview` | Lambda functions — runtime, memory, timeout, env var key names |
| `get_log_errors` | CloudWatch error patterns and counts (no raw log messages) |

---

## CLI reference

| Command | What it does |
|---|---|
| `infrawise init` | Detect AWS + repo, generate `infrawise.yaml` |
| `infrawise auth` | Select or switch AWS profile |
| `infrawise analyze` | Scan repo + AWS, build graph, print findings |
| `infrawise dev` | Start MCP server — auto-analyzes if no cache, watches files for live refresh |
| `infrawise doctor` | Validate AWS access, DB connectivity, and config |

---

## Configuration

`infrawise.yaml` is generated by `infrawise init` and lives in your repo root. Every service must be explicitly `enabled: true` — infrawise never connects to anything not listed in config.

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
  profile: default          # AWS profile from ~/.aws/credentials
  region: ap-south-1

dynamodb:
  enabled: true
  includeTables:            # omit to include all tables
    - Orders
    - Users

postgres:
  enabled: true
  connectionString: postgresql://infrawise_ro:${DB_PASSWORD}@host:5432/mydb

mysql:
  enabled: false
  connectionString: ""

mongodb:
  enabled: false
  connectionString: ""

sqs:
  enabled: true

sns:
  enabled: true

ssm:
  enabled: true
  paths: []                 # filter by prefix e.g. ["/myapp/prod"]

secretsManager:
  enabled: true

lambda:
  enabled: true

rds:
  enabled: false

kafka:
  enabled: false

cloudwatchLogs:
  enabled: false
  logGroupPrefixes: []
  windowHours: 24

analysis:
  sampleSize: 100
```

### AWS setup

Infrawise is **read-only**. Minimum IAM policy required:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:ListTables",
        "dynamodb:DescribeTable"
      ],
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

| Service | What it checks |
|---|---|
| DynamoDB schema | Tables, GSIs, partition keys |
| PostgreSQL / MySQL schema | Tables, indexes, column types |
| MongoDB schema | Collections, indexes |
| SQS | Missing DLQs, unencrypted queues, large backlogs |
| Kafka (kafkajs) | Producer/consumer topic mapping from code |
| Secrets Manager | Missing secret rotation |
| Lambda | Default memory (128 MB), high timeouts |
| RDS | Publicly accessible, no backups, unencrypted, no deletion protection, single-AZ |
| CloudWatch Logs | Log groups with no retention policy |
| Terraform / CloudFormation / CDK | IaC drift vs deployed state |

### Code correlation analysis (TypeScript / JavaScript)

Uses [ts-morph](https://ts-morph.com/) AST analysis to detect which functions call which tables and how:

| Analyzer | Severity | What it detects |
|---|---|---|
| Full Table Scan (DynamoDB) | High | `.scan()` calls without filters |
| Missing GSI | Medium | Queries on attributes without a matching GSI |
| Hot Partition | Medium | 5+ distinct code paths hitting the same table |
| Missing Index (PostgreSQL) | Medium | Tables queried without indexes |
| N+1 Query | Medium | Repeated query patterns from ORM loops |
| Large SELECT | Low | `SELECT *` usage |
| Missing MySQL Index | Medium | MySQL tables queried without indexes |
| MySQL Full Table Scan | High | Full table scan patterns in MySQL queries |
| Missing Mongo Index | Medium | Collections queried without secondary indexes |
| Collection Scan | High | `find()` calls without filter predicates |

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

---

## Architecture overview

```
Your repo (any language)          Your repo (TS/JS only)
        │                                  │
        │                    Repository Scanner (ts-morph AST)
        │                     which functions → which tables
        │                                  │
┌───────┴──────────────────────────────────┴────────────┐
│  infrawise analyze                                    │
│                                                       │
│  AWS APIs / DB schema / IaC files  +  Code ops (opt)  │
│         (works for any project)      (TS/JS only)     │
│                          │                            │
│                     Graph Engine                      │
│                   (nodes + edges)                     │
│                          │                            │
│                   Analyzer Engine                     │
│               (rule-based, deterministic)             │
└─────────────────────────┬─────────────────────────────┘
                          │
               ┌──────────────────┐
               │   MCP Server     │ ◄── Claude Code
               │  localhost:3000  │ ◄── Cursor
               └──────────────────┘ ◄── Windsurf
```

### Source layout

```
src/
  types.ts      Shared type definitions
  core/         Config (Zod + YAML), logger (Pino), local cache
  graph/        Graph engine — nodes, edges, builder
  adapters/     Flat extractors: dynamodb.ts, postgres.ts, mysql.ts,
                mongodb.ts, aws.ts, logs.ts, terraform.ts
  analyzers/    23 rule-based analyzers
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

Feature roadmap is tracked in the [GitHub Project](https://github.com/users/Sidd27/projects/1). Priorities, complexity, and virality scores are visible there. Feature requests and upvotes welcome.

### Planned
- Runtime tracing integration
- Incremental analysis for large monorepos
- Kubernetes workload graphing
- VS Code extension
- Infrastructure drift detection
- MSK (Amazon Managed Streaming for Apache Kafka) — cluster metadata + topic listing via MSK API and Kafka admin client

### Under consideration
- OpenTelemetry integration
- CI/CD reporting mode
- Multi-repository graph correlation

---

## Contributing

### Prerequisites

Node.js 24+, pnpm 9+, AWS CLI (for integration testing).

### Setup

```bash
git clone https://github.com/Sidd27/infrawise
cd infrawise
pnpm install
pnpm build
```

### Development workflow

```bash
pnpm build        # compile
pnpm test         # run all tests
pnpm typecheck    # TypeScript strict check
pnpm lint         # ESLint
```

### Adding a new analyzer

1. Create your analyzer in `src/analyzers/`
2. Implement the `Analyzer` interface:
```ts
export class MyAnalyzer implements Analyzer {
  name = 'MyAnalyzer';
  async analyze(graph: SystemGraph): Promise<Finding[]> { ... }
}
```
3. Export it from `src/analyzers/index.ts`
4. Add tests in `src/analyzers/__tests__/`

### Adding a new database adapter

1. Create your extractor as `src/adapters/yourdb.ts`
2. Export a function returning `Promise<YourTableMetadata[]>`
3. Add the metadata type to `src/types.ts` if needed
4. Wire it into `src/cli/commands/analyze.ts`

### Releasing

```bash
pnpm release patch    # 0.1.2 → 0.1.3  (bug fixes)
pnpm release minor    # 0.1.2 → 0.2.0  (new features, backwards compatible)
pnpm release major    # 0.1.2 → 1.0.0  (breaking changes)
pnpm release 1.5.0    # explicit version
```

Bumps `package.json`, commits, tags, pushes, and creates a draft GitHub release with notes from commit messages. Then publish the draft on GitHub to trigger npm publish.

### PR checklist

- `pnpm lint` passes
- `pnpm typecheck` passes
- `pnpm test` passes
- New analyzers have unit tests with mock graph data
- No hardcoded AWS regions or credentials

---

## License

MIT
