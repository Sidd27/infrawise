# Infrawise

**Understand your infrastructure, not just your code.**

Infrawise is a CLI tool that analyzes how your TypeScript codebase interacts with DynamoDB and PostgreSQL — detecting full table scans, missing indexes, N+1 patterns, and hot partitions. It then exposes those findings as an MCP server so Claude Code has live, deterministic knowledge of your infrastructure when helping you write database code.

---

## Why this exists

When Claude Code helps you write database queries, it reads your source files but has no knowledge of your actual infrastructure — it doesn't know your DynamoDB partition keys, which GSIs exist, or which functions are already doing expensive scans. It guesses.

Infrawise fixes that. It runs a static analysis of your repo, maps every function-to-table relationship into a graph, and starts a local MCP server. Claude Code can then call tools like `get_graph_summary`, `analyze_function`, and `suggest_gsi` in real time — giving it exact knowledge of your schema and access patterns before writing a single line of database code.

**Without Infrawise**, Claude might:
- Suggest a `.scan()` on your Orders table that has 50M rows
- Recommend adding a GSI on `status` that you already have
- Write a SELECT * when you need to keep query cost low
- Not notice that 5 functions are hammering the same partition key

**With Infrawise**, Claude knows:
- Your exact table schemas, partition keys, sort keys, and GSIs
- Which functions already query which tables and how
- Which patterns are already flagged as high severity in your codebase
- The exact `CREATE INDEX` or GSI config to recommend for your specific tables

---

## Prerequisites

### System

| Requirement | Version | Check |
|---|---|---|
| Node.js | 22+ | `node --version` |
| pnpm | 9+ | `pnpm --version` |
| AWS CLI | any | `aws --version` |

Install pnpm if you don't have it:
```bash
npm install -g pnpm
```

### AWS credentials

Infrawise reads your existing AWS credentials — it does not store or transmit them anywhere.

You need `~/.aws/credentials` or `~/.aws/config` with at least one profile:

```ini
# ~/.aws/credentials
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = ...

# or for SSO
[myprofile]
sso_start_url = https://myorg.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789
sso_role_name = DeveloperAccess
```

If you use SSO, log in before running infrawise:
```bash
aws sso login --profile myprofile
```

### AWS IAM permissions required

Infrawise is **read-only**. The minimum IAM policy:

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

It never calls write APIs, never modifies schemas, never touches IAM.

### PostgreSQL (optional)

If you use PostgreSQL, you need a read-only database user with access to `information_schema`:

```sql
-- Create a read-only user for infrawise
CREATE USER infrawise_ro WITH PASSWORD 'yourpassword';
GRANT CONNECT ON DATABASE yourdb TO infrawise_ro;
GRANT USAGE ON SCHEMA public TO infrawise_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO infrawise_ro;
```

For Amazon RDS: ensure your security group allows inbound connections on port 5432 from your machine's IP.

---

## Installation

### Via npm (once published)

```bash
npm install -g infrawise
# or
npx infrawise init
```

### From source (local development)

```bash
git clone https://github.com/yourusername/infrawise
cd infrawise
pnpm install
pnpm build

# Link globally so you can use it in any repo
cd packages/cli
npm link
```

---

## Setup in your repo

Run this once inside your TypeScript project:

```bash
infrawise init
```

This detects your AWS profile and region, asks a few questions, and writes `infrawise.yaml` to your repo root. That's the only file it creates in your project.

```bash
✔ Detected repository: payments-service
✔ Repository type: typescript
✔ AWS profile: default
✔ Found DynamoDB tables: Orders, Users, Sessions
✔ Created infrawise.yaml
```

Validate everything is connected:

```bash
infrawise doctor
```

---

## CLI commands

| Command | What it does |
|---|---|
| `infrawise init` | Detect AWS + repo, generate `infrawise.yaml` |
| `infrawise auth` | Select/switch AWS profile |
| `infrawise analyze` | Scan repo + AWS, build graph, print findings |
| `infrawise dev` | Start MCP server at `http://localhost:3000/mcp` |
| `infrawise doctor` | Validate AWS access, DB connectivity, config |

### infrawise analyze

Runs the full pipeline and prints findings to your terminal:

```
Findings (3 total)

1. [HIGH] Full table scan detected on DynamoDB table "Orders"
   The table "Orders" is being scanned without any filter by listAllOrders().
   Recommendation: Replace Scan with Query using a partition key or add a GSI.

2. [MEDIUM] PostgreSQL table "users" has no index on column "email"
   Filtering on "email" without an index causes sequential scans.
   Recommendation: CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

3. [MEDIUM] DynamoDB table "Sessions" accessed by 6 distinct code paths
   High access concentration may create hot partition issues at scale.
```

---

## Claude Code integration (MCP)

This is where Infrawise becomes genuinely useful for your development workflow.

### Step 1: Start the MCP server in your repo

```bash
infrawise dev
```

```
✔ Tool server running
✔ Context engine initialized

MCP endpoint: http://localhost:3000/mcp
Available tools: http://localhost:3000/mcp/tools
```

### Step 2: Add to Claude Code settings

Add infrawise as an MCP server in your Claude Code config. Create or edit `.claude/settings.json` in your repo (or `~/.claude/settings.json` globally):

```json
{
  "mcpServers": {
    "infrawise": {
      "command": "node",
      "args": ["/absolute/path/to/infrawise/packages/cli/dist/index.js", "dev"],
      "env": {}
    }
  }
}
```

Replace the path with the actual path to your infrawise installation. Claude Code will start the server automatically when you open a session.

Or if you prefer to keep the server running manually (recommended during development):

```bash
# Terminal 1 — keep this running
infrawise dev

# Terminal 2 — your normal work
claude  # Claude Code now has access to infrawise tools
```

When running the server manually, add it as an HTTP MCP server instead:

```json
{
  "mcpServers": {
    "infrawise": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Restart Claude Code after editing settings.

### Step 3: What Claude can now do

Claude Code gains four tools it can call silently in the background while helping you:

**`get_graph_summary`** — before writing any database code, Claude fetches your full infrastructure graph: all tables, partition keys, GSIs, function-to-table relationships, and existing findings. No more "can you share your schema?"

**`analyze_function`** — after writing a new function, Claude checks whether it introduced a scan pattern, missing index usage, or other issue before suggesting it to you.

**`suggest_gsi`** — instead of generic advice, Claude returns the exact GSI configuration for your specific table and access pattern:
```json
{
  "index": {
    "name": "Orders-status-index",
    "partitionKey": "status",
    "projectionType": "ALL"
  }
}
```

**`postgres_index_suggestions`** — Claude returns the exact SQL for your actual table:
```sql
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
```

### What changes in practice

Before infrawise, a typical conversation looks like:
> You: "Write a function to get all orders by user"
> Claude: *writes a DynamoDB scan() without knowing your schema*

After infrawise:
> You: "Write a function to get all orders by user"
> Claude: *calls get_graph_summary → sees Orders table has userId-index GSI → writes a Query against the GSI → notes that listAllOrders() already does a scan and flags it*

---

## Configuration reference

`infrawise.yaml` (generated by `infrawise init`):

```yaml
project: payments-service

aws:
  profile: default          # AWS profile from ~/.aws/credentials
  region: ap-south-1        # AWS region

dynamodb:
  includeTables:            # leave empty to include all tables
    - Orders
    - Users

postgres:
  enabled: true
  connectionString: postgresql://infrawise_ro:password@localhost:5432/mydb

analysis:
  sampleSize: 100           # number of items to sample per table
```

---

## What gets analyzed

### DynamoDB

| Analyzer | Severity | What it detects |
|---|---|---|
| Full Table Scan | High | `.scan()` calls without filters |
| Missing GSI | Medium | Tables queried without GSIs for the access pattern |
| Hot Partition | Medium | 5+ distinct functions accessing the same table |

### PostgreSQL

| Analyzer | Severity | What it detects |
|---|---|---|
| Missing Index | Medium/High | Columns filtered without indexes |
| N+1 Query | Medium | Repeated query patterns suggesting ORM inefficiency |
| Large SELECT | Low | `SELECT *` usage patterns |

---

## Architecture

```
Your repo
    ↓
infrawise analyze
    ↓
Repository Scanner (ts-morph AST)    AWS DynamoDB     PostgreSQL
    ↓                                     ↓                ↓
                    Graph Engine
                    (nodes + edges)
                         ↓
                   Analyzer Engine
                   (rule-based, deterministic)
                         ↓
              ┌──────────────────────┐
              │   MCP Server         │
              │   localhost:3000     │◄── Claude Code
              └──────────────────────┘
```

All analysis is deterministic — no LLM involved. Claude is only used at the consumption layer, not in the analysis itself.

---

## Security

- **Read-only**: Infrawise never writes to AWS or your database
- **Local-first**: Everything runs on your machine, nothing is sent to external servers
- **No telemetry**: Zero data collection
- **Credentials**: Uses your existing AWS credential chain (`~/.aws/credentials`, environment variables, IAM roles) — never stored by infrawise

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (36 tests across analyzers, graph, config)
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

### Package structure

| Package | Description |
|---|---|
| `@infrawise/shared` | Shared TypeScript types |
| `@infrawise/core` | Config (Zod + YAML), logger (Pino), cache |
| `@infrawise/graph` | Graph engine — nodes, edges, builder |
| `@infrawise/adapters-dynamodb` | DynamoDB extractor (AWS SDK v3) |
| `@infrawise/adapters-postgres` | PostgreSQL extractor (pg) |
| `@infrawise/context` | Repository scanner (ts-morph AST) |
| `@infrawise/analyzers` | 6 rule-based analyzers |
| `@infrawise/server` | Fastify MCP HTTP server |
| `infrawise` | CLI (Commander.js) |

---

## Roadmap

- [ ] MySQL adapter
- [ ] MongoDB adapter
- [ ] Terraform/CloudFormation schema correlation
- [ ] Latency tracing integration
- [ ] VS Code extension
- [ ] Kubernetes workload graph

---

## Contributing

1. Fork the repo
2. Create a feature branch
3. Run `pnpm test` and `pnpm typecheck` — both must pass
4. Open a PR

---

## License

MIT
