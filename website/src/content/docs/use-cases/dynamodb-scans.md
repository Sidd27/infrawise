---
title: Stopping DynamoDB full table scans before they hit production
description: Infrawise detects full DynamoDB table scans, missing GSIs, and hot partition patterns in your codebase — and gives Claude Code the context to fix them before deploy.
---

When an AI coding assistant writes a DynamoDB `Scan` instead of a `Query`, or queries a table on a non-key attribute without a GSI, the code looks correct until it runs against a table with a million items. Infrawise detects these patterns statically — before the code ever deploys — and surfaces them as findings your AI can act on immediately.

## What Infrawise detects

Infrawise runs three analyzers against your DynamoDB tables and access patterns:

**Full table scan — high severity**

If any function in your codebase performs a DynamoDB `Scan` without a filter expression, Infrawise flags it as a high-severity finding. The finding identifies which function is responsible and recommends replacing the scan with a `Query` using a partition key or GSI.

**Missing GSI — medium severity**

If a table is queried by one or more functions but has no Global Secondary Indexes defined, Infrawise flags it at medium severity. This indicates queries are likely hitting the table's primary key only, which forces a full scan any time the access pattern uses a non-key attribute.

**Hot partition — medium severity**

If the same DynamoDB table is accessed by five or more distinct code paths, Infrawise surfaces a hot partition warning. High write concentration on a single partition key value leads to request throttling at scale. The finding recommends write sharding or DynamoDB DAX for read-heavy workloads.

## How to use it

**Detect scan patterns in a specific function:**

```
analyze_function({ function: "getOrdersByUser" })
```

Returns which tables the function accesses, whether it uses `scan` or `query` edge types, and any related findings scoped to that function.

**Get a ready-to-deploy GSI definition:**

```
suggest_gsi({ table: "Orders", attribute: "userId" })
```

Returns the index name, partition key, projection type, and billing mode (matching your table's existing billing configuration) — ready to paste into your Terraform or CDK.

**See all DynamoDB findings at once:**

```
get_infra_overview()
```

Returns all high-severity findings across your account. Full table scan findings appear here immediately — no need to inspect each table individually.

## Why this matters for AI-assisted development

Without infrastructure context, Claude Code and Cursor see your DynamoDB table as a name in a string. They don't know the partition key, whether a GSI exists for the access pattern they're implementing, or how many functions already access the same table. They guess — and a `Scan` is a reasonable guess when no schema context is available.

With Infrawise running, `analyze_function` gives the AI the exact query patterns already in use on a table before it writes new access code. If a GSI is missing for the attribute being queried, the AI can call `suggest_gsi` and generate the correct index definition in the same session.

---

## FAQ

### Does Infrawise detect DynamoDB scans in all languages?

Infrawise analyzes TypeScript, JavaScript, and Python source files via AST scanning. It detects `scan` and `query` call patterns in code that uses the AWS SDK (`boto3`/`dynamodb.Table()` in Python).

### What is the difference between the scan finding and the missing GSI finding?

The scan finding flags an existing `Scan` call in your code — a runtime operation that reads every item. The missing GSI finding is predictive: it flags a table that will degrade to a scan when queries filter on non-key attributes, even if no explicit `Scan` call exists yet.

### Does suggest_gsi create the index automatically?

No. `suggest_gsi` returns a definition — index name, keys, projection, billing mode — that you apply through your IaC or the AWS console. Infrawise never writes to AWS.

### How many DynamoDB tables can Infrawise analyze?

Infrawise scans all tables in the AWS region configured in your `infrawise.yaml`. There is no per-table limit.
