---
title: Quick start
description: Go from zero to a working Infrawise + Claude Code setup in under 60 seconds — configure credentials, create infrawise.yaml, and start asking your AI about your infrastructure.
---

This guide gets Infrawise connected to Claude Code and talking to your AWS environment in five steps. By the end, your AI assistant can call all 21 Infrawise MCP tools to inspect infrastructure, identify issues, and suggest fixes — without you leaving your editor.

If you haven't installed Infrawise yet, start with the [installation guide](/infrawise/getting-started/installation/).

## Step 1: Configure your AWS credentials

Infrawise uses your existing AWS credentials — the same ones the AWS CLI uses. If you haven't set up credentials and the required IAM policy yet, see [AWS setup](/infrawise/getting-started/aws-setup/) first.

## Step 2: Create `infrawise.yaml`

`infrawise start` auto-generates `infrawise.yaml` on its first run by probing your environment — you usually do not need to create it by hand:

```bash
infrawise start
```

Infrawise detects your AWS credentials, region, and any local databases, then writes `infrawise.yaml` for you. If you want to answer the questions yourself instead of relying on auto-discovery, pass `--interactive`. Or create `infrawise.yaml` manually:

```yaml
services:
  aws:
    region: us-east-1
    # profile: my-profile   # optional — uses default credential chain if omitted
  databases:
    postgres:
      - host: localhost
        port: 5432
        database: myapp
        user: postgres
        password: ${POSTGRES_PASSWORD}
```

See the [configuration reference](/infrawise/reference/configuration/) for all available options.

## Step 3: Start Infrawise

```bash
infrawise start --claude
```

Infrawise scans your infrastructure, runs 34 analyzers, and writes `.mcp.json` to the current directory. Open Claude Code in the same directory — all 21 MCP tools are immediately available.

:::tip
Using Cursor instead? Run `infrawise start --cursor` to write `.cursor/mcp.json` and open Cursor directly.
:::

## Step 4: Ask your AI assistant

In Claude Code, try:

```
What infrastructure issues should I fix first?
```

Claude Code calls `get_infra_overview` and returns a prioritized list of findings across your AWS services and databases.

## Step 5: Drill into a specific function

Once you have the overview, follow up with function-level analysis:

```
Analyze the processOrder function for infrastructure issues.
```

Claude Code calls `analyze_function` with `{ "function": "processOrder" }` and returns the services it accesses, its trigger event shape (e.g. `event.Records[0].body` for SQS-triggered handlers), and any related findings. This is the most useful tool when writing or reviewing Lambda handlers.

---

## FAQ

### What does "analyzing infrastructure" mean?

Infrawise connects to your configured AWS services using read-only API calls, extracts resource metadata (table definitions, queue configs, Lambda settings, etc.), and runs 34 rule-based analyzers against that metadata. Analyzers check for patterns like missing DLQs, default Lambda memory, disabled secret rotation, and IaC drift. No data — database rows, log messages, secret values — is ever read.

### How long does the first run take?

Typically 5 to 15 seconds for a mid-sized AWS environment. Time scales with the number of resources (Lambda functions, DynamoDB tables, SQS queues, etc.) because each resource requires at least one AWS API call. Subsequent calls from your AI editor hit the in-memory cache and return instantly.

### Do I need to run `infrawise start` every time?

Only when your infrastructure changes. `infrawise start` writes a static `.mcp.json` that points your editor to the Infrawise stdio server — the editor manages the server process from there. If you add new AWS resources, run `infrawise start` again (or `infrawise analyze`) to refresh the graph. For a long-running server that stays in sync, use `infrawise serve` instead.
