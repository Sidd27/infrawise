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

Claude gains four tools it calls silently while helping you:

| Tool | What it gives Claude |
|---|---|
| `get_graph_summary` | Full infrastructure graph — tables, GSIs, function relationships, all findings |
| `analyze_function` | Issues introduced by a specific function — scans, missing indexes, N+1 |
| `suggest_gsi` | Exact GSI config for a DynamoDB table + attribute |
| `postgres_index_suggestions` | Exact `CREATE INDEX` SQL for your actual table |
| `suggest_mongo_index` | Exact `createIndex` command for a MongoDB collection + field |
| `mysql_index_suggestions` | Exact `ALTER TABLE ADD INDEX` SQL for your MySQL table |

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

`infrawise.yaml` is generated by `infrawise init` and lives in your repo root:

```yaml
project: payments-service

aws:
  profile: default          # AWS profile from ~/.aws/credentials
  region: ap-south-1

dynamodb:
  includeTables:            # omit to include all tables
    - Orders
    - Users

postgres:
  enabled: true
  connectionString: postgresql://infrawise_ro:password@host:5432/mydb

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

## What gets analyzed

### DynamoDB

| Analyzer | Severity | What it detects |
|---|---|---|
| Full Table Scan | High | `.scan()` calls without filters |
| Missing GSI | Medium | Tables queried without a matching GSI |
| Hot Partition | Medium | 5+ distinct code paths hitting the same table |

### PostgreSQL

| Analyzer | Severity | What it detects |
|---|---|---|
| Missing Index | Medium/High | Columns filtered without indexes |
| N+1 Query | Medium | Repeated query patterns from ORM inefficiencies |
| Large SELECT | Low | `SELECT *` usage |

### MySQL

| Analyzer | Severity | What it detects |
|---|---|---|
| Missing MySQL Index | Medium | Tables queried without indexes |
| MySQL Full Table Scan | High | Scan operations on MySQL tables |

### MongoDB

| Analyzer | Severity | What it detects |
|---|---|---|
| Missing Mongo Index | Medium | Collections queried without secondary indexes |
| Collection Scan | High | Full collection scan operations |

### Terraform / CloudFormation (IaC Drift)

| Analyzer | Severity | What it detects |
|---|---|---|
| IaC Drift | Medium | DynamoDB tables defined in IaC but not deployed in AWS |
| IaC Drift | Medium | DynamoDB tables deployed in AWS but not defined in IaC |

---

## Security

- **Read-only** — never writes to AWS or your database, never executes DDL
- **Local-first** — everything runs on your machine, nothing sent to external servers
- **No telemetry** — zero data collection
- **Credentials** — uses your existing AWS credential chain, never stored by infrawise

---

## Architecture

```
Your TypeScript repo
        ↓
┌───────────────────────────────────────────────────────┐
│  infrawise analyze                                    │
│                                                       │
│  Repository Scanner    AWS DynamoDB    PostgreSQL     │
│  (ts-morph AST)             ↓              ↓         │
│        ↓                    └──────┬───────┘          │
│        └────────────────────►      │                  │
│                          Graph Engine                 │
│                        (nodes + edges)                │
│                              ↓                        │
│                       Analyzer Engine                 │
│                    (rule-based, deterministic)        │
└──────────────────────────────┬────────────────────────┘
                               ↓
                    ┌──────────────────┐
                    │   MCP Server     │ ◄── Claude Code
                    │  localhost:3000  │ ◄── Cursor
                    └──────────────────┘ ◄── Windsurf
```

The analysis is entirely deterministic — no LLM is involved in extracting or analyzing your infrastructure. AI is only at the consumption layer.

### Package structure

| Package | Description |
|---|---|
| `@infrawise/shared` | Shared TypeScript types |
| `@infrawise/core` | Config (Zod + YAML), logger (Pino), local cache |
| `@infrawise/graph` | Graph engine — nodes, edges, builder |
| `@infrawise/adapters-dynamodb` | DynamoDB extractor (AWS SDK v3) |
| `@infrawise/adapters-postgres` | PostgreSQL extractor (pg) |
| `@infrawise/adapters-mysql` | MySQL extractor (mysql2) |
| `@infrawise/adapters-mongodb` | MongoDB extractor (mongodb driver) |
| `@infrawise/adapters-terraform` | Terraform and CloudFormation IaC schema extractor |
| `@infrawise/context` | Repository scanner (ts-morph AST) |
| `@infrawise/analyzers` | 11 rule-based analyzers |
| `@infrawise/server` | Fastify MCP HTTP server |
| `infrawise` | CLI (Commander.js) |

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
| Node.js | 22+ |
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

Tests live in:
- `packages/core/src/__tests__/` — config validation
- `packages/graph/src/__tests__/` — graph builder
- `packages/analyzers/src/__tests__/` — all 6 analyzers

### Adding a new analyzer

1. Create your analyzer in `packages/analyzers/src/`
2. Implement the `Analyzer` interface:
```ts
export class MyAnalyzer implements Analyzer {
  name = 'MyAnalyzer';
  async analyze(graph: SystemGraph): Promise<Finding[]> { ... }
}
```
3. Register it in `packages/analyzers/src/index.ts`
4. Add tests in `packages/analyzers/src/__tests__/`

### Adding a new database adapter

1. Create a new package under `packages/adapters/yourdb/`
2. Export a function returning `Promise<YourTableMetadata[]>`
3. Extend `SystemGraph` node types in `@infrawise/shared` if needed
4. Wire it into `packages/cli/src/commands/analyze.ts`

### PR checklist

- `pnpm test` passes
- `pnpm typecheck` passes
- New analyzers have unit tests with mock graph data
- No hardcoded AWS regions or credentials

---

## License

MIT
