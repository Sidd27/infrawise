# Infrawise

[![npm version](https://img.shields.io/npm/v/infrawise)](https://www.npmjs.com/package/infrawise)
[![Publish to npm](https://github.com/Sidd27/infrawise/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/Sidd27/infrawise/actions/workflows/npm-publish.yml)
[![CI](https://github.com/Sidd27/infrawise/actions/workflows/ci.yml/badge.svg)](https://github.com/Sidd27/infrawise/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Understand your infrastructure, not just your code.**

Infrawise is a CLI tool that scans your TypeScript codebase, maps every function-to-database relationship into a graph, detects anti-patterns (full table scans, missing indexes, hot partitions, N+1 queries), and exposes all of it as an MCP server — so AI coding assistants like Claude Code have live, deterministic knowledge of your infrastructure when helping you write database code.

---

## Why this exists

When AI coding assistants help you write database queries, they read your source files but have no knowledge of your actual infrastructure. They don't know your DynamoDB partition keys, which GSIs exist, or which functions are already doing expensive scans. They guess.

Infrawise fixes that. It runs a static analysis of your repo, builds an infrastructure graph, and starts a local MCP server. Claude Code can then call tools like `get_graph_summary`, `analyze_function`, and `suggest_gsi` in real time — giving it exact knowledge of your schema and access patterns before writing a single line of database code.

**Without Infrawise**, Claude might:
- Suggest a `.scan()` on your Orders table that has 50M rows
- Recommend adding a GSI on `status` that you already have
- Write a `SELECT *` when you need to keep query cost low
- Not notice that 5 functions are already hammering the same partition key

**With Infrawise**, Claude knows:
- Your exact table schemas, partition keys, sort keys, and GSIs
- Which functions query which tables and how
- Which patterns are already flagged as high severity in your codebase
- The exact `CREATE INDEX` SQL or GSI config for your specific tables — not generic advice

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

```
✔ Detected repository: payments-service
✔ Repository type: typescript
✔ AWS profile: default
✔ Found DynamoDB tables: Orders, Users, Sessions
✔ Created infrawise.yaml
```

**2. Validate everything is connected**

```bash
infrawise doctor
```

**3. Run analysis**

```bash
infrawise analyze
```

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

## Using with Claude Code

This is where Infrawise becomes most useful. Once wired up, Claude Code has live access to your infrastructure graph — it stops guessing and starts knowing.

### Step 1: Start the MCP server

```bash
infrawise dev
```

```
✔ Tool server running
✔ Context engine initialized

MCP endpoint:      http://localhost:3000/mcp
Available tools:   http://localhost:3000/mcp/tools
```

### Step 2: Add to Claude Code settings

Edit `.claude/settings.json` in your repo (project-level) or `~/.claude/settings.json` (global):

```json
{
  "mcpServers": {
    "infrawise": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Restart Claude Code. The tools are now available in every conversation.

Alternatively, let Claude Code manage the server lifecycle automatically:

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

### Step 3: What Claude can now do

Claude gains 13 tools it calls silently while helping you:

| Tool | What it gives Claude |
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

### What changes in practice

**Before Infrawise:**
> You: "Write a function to get all orders by userId"
> Claude: *writes a DynamoDB `.scan()` filtered client-side — no schema context*

**After Infrawise:**
> You: "Write a function to get all orders by userId"
> Claude: *calls `get_graph_summary` → sees Orders has a `userId-index` GSI → writes a `.query()` against the GSI → notes `listAllOrders()` already does a full scan and flags it proactively*

### Using with other AI editors

Infrawise works with any editor or tool that supports MCP or can call an HTTP API:

- **Cursor** — add `http://localhost:3000/mcp` as an MCP server in Cursor settings
- **Windsurf** — same, via MCP server configuration
- **Any Claude API project** — call the endpoint directly from your own tooling

---

## CLI reference

| Command | What it does |
|---|---|
| `infrawise init` | Detect AWS + repo, generate `infrawise.yaml` |
| `infrawise auth` | Select or switch AWS profile |
| `infrawise analyze` | Scan repo + AWS, build graph, print findings |
| `infrawise dev` | Start MCP server at `http://localhost:3000/mcp` |
| `infrawise doctor` | Validate AWS access, DB connectivity, and config |

---

## Configuration

`infrawise.yaml` is generated by `infrawise init` and lives in your repo root. Every service must be explicitly `enabled: true` — infrawise never connects to anything not listed in config.

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
  connectionString: postgresql://infrawise_ro:password@host:5432/mydb

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

## Language support

Infrawise has two analysis layers with different language requirements:

### Infrastructure-level analysis — any project, any language

The following analyzers work purely from infrastructure metadata (AWS APIs, database schema introspection, IaC files). They have no dependency on your application code or language:

| Service | What it checks |
|---|---|
| DynamoDB schema | Tables, GSIs, partition keys |
| PostgreSQL / MySQL schema | Tables, indexes, column types |
| MongoDB schema | Collections, indexes |
| SQS | Missing DLQs, unencrypted queues, large backlogs |
| Secrets Manager | Missing secret rotation |
| Lambda | Default memory (128 MB), high timeouts |
| RDS | Publicly accessible, no backups, unencrypted, no deletion protection, single-AZ |
| CloudWatch Logs | Log groups with no retention policy |
| Terraform / CloudFormation / CDK | IaC drift vs deployed state |

### Code-level analysis — TypeScript and JavaScript only

The repository scanner uses [ts-morph](https://ts-morph.com/) for static AST analysis. It detects which functions call which tables and how, enabling pattern detection that requires correlating code with infrastructure:

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

**Non-TypeScript/JavaScript projects** still get full value from all infrastructure-level analyzers. The code correlation layer (which functions hit which tables, N+1 patterns) is skipped — run `infrawise analyze` and it will report 0 code operations while still surfacing all schema, configuration, and IaC findings.

The scanner detects these patterns in TypeScript and JavaScript files:

- **DynamoDB** — AWS SDK v3 (`client.send(new QueryCommand(...))`) and v2-style (`dynamoDb.scan(...)`)
- **PostgreSQL** — `pg` pool/client queries, Prisma, Knex
- **MySQL** — `mysql2` connection/pool queries, Knex with MySQL dialect
- **MongoDB** — driver `collection.find/findOne/aggregate`, Mongoose models
- **SQS / SNS / SSM / Secrets / Lambda** — AWS SDK v3 command pattern

---

## Security

- **Read-only** — never writes to AWS or your database, never executes DDL
- **Local-first** — everything runs on your machine, nothing sent to external servers
- **No telemetry** — zero data collection
- **Credentials** — uses your existing AWS credential chain, never stored by infrawise

---

## Architecture

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

The analysis is entirely deterministic — no LLM is involved in extracting or analyzing your infrastructure. AI is only at the consumption layer.

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
  server/       Fastify MCP HTTP server (plain JSON-RPC, no SDK)
  cli/          CLI commands (Commander.js)
```

---

## Roadmap

- [x] MySQL adapter
- [x] MongoDB adapter
- [x] Terraform / CloudFormation schema correlation
- [ ] Latency tracing integration
- [ ] VS Code extension
- [ ] Kubernetes workload graph
- [ ] Infra drift detection

---

## Contributing

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 24+ |
| pnpm | 9+ |
| AWS CLI | any (for integration testing) |

```bash
# Install pnpm if you don't have it
npm install -g pnpm
```

### Setup

```bash
git clone https://github.com/Sidd27/infrawise
cd infrawise
pnpm install
pnpm build
```

### Development workflow

```bash
pnpm build        # build all packages
pnpm test         # run all tests
pnpm typecheck    # TypeScript strict check
pnpm lint         # ESLint
```

Tests live in `src/**/__tests__/`:
- `src/core/__tests__/` — config validation, cache
- `src/graph/__tests__/` — graph builder
- `src/analyzers/__tests__/` — all analyzers
- `src/server/__tests__/` — MCP server (Fastify inject, all 13 tools)
- `src/context/__tests__/` — repository scanner

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

The git tag is the source of truth. The version in root `package.json` and the tag must always match — the release script does both atomically.

```bash
pnpm release patch    # 0.1.2 → 0.1.3  (bug fixes)
pnpm release minor    # 0.1.2 → 0.2.0  (new features, backwards compatible)
pnpm release major    # 0.1.2 → 1.0.0  (breaking changes)
pnpm release 1.5.0    # explicit version

git push origin main --tags
```

**What happens after push:**

1. `release.yml` fires on the `v*.*.*` tag → creates a **draft** GitHub release with auto-generated notes
2. Review the draft on GitHub → click **Publish release**
3. `npm-publish.yml` fires on publish → reads the version from the tag, stamps it onto `package.json`, builds, and publishes to npm

The CLI reads its version from root `package.json` at runtime, so `infrawise --version` always matches the installed package.

### PR checklist

- `pnpm lint` passes (no errors)
- `pnpm typecheck` passes
- `pnpm test` passes
- New analyzers have unit tests with mock graph data
- No hardcoded AWS regions or credentials

---

## License

MIT
