---
title: MCP tools reference
description: All 15 MCP tools exposed by Infrawise — inputs, return shape, when to call, and common patterns.
---

Infrawise exposes **15 MCP tools** via a local stdio or HTTP server. Run `infrawise start` once to analyze your infrastructure and write the editor config. After that your editor manages the server — no commands to run between sessions.

:::tip
Start every session with `get_infra_overview`. It costs one tool call and gives you everything you need to know what infrastructure exists before writing any code.
:::

---

## get_infra_overview

**Start here.** Returns a compact snapshot of your entire infrastructure — counts, all service names, and every high-severity finding with its recommendation. Designed to be the first call in any session.

No inputs required.

**Returns**

- Summary counts: tables, functions, queues, topics, secrets, lambdas, buckets
- Full list of databases, AWS services, and S3 buckets by name
- All high-severity findings with actionable recommendations

**When to call:** At the start of any task that touches infrastructure — adding a Lambda, writing a queue consumer, creating a new index, debugging a deployment issue.

**When NOT to call:** Don't repeat it mid-session unless you've run `infrawise analyze` to refresh the data. The graph is built once per analyze run; calling overview twice returns the same data.

---

## get_graph_summary

Returns the complete infrastructure graph: every node, every edge, and all findings at every severity level. More data than `get_infra_overview` — use it when you need to trace relationships across services.

No inputs required.

**Returns**

- All `nodes` — tables, queues, lambdas, topics, buckets, and more
- All `edges` — typed relationships: `query`, `scan`, `publishes_to`, `triggered_by`, `reads_from`, etc.
- All `findings` with severity, resource name, and recommendation
- Summary counts

**When to call:** When reviewing an entire service for the first time, auditing cross-service dependencies, or tracing why a function has access to a resource you didn't expect.

---

## analyze_function

Analyzes a single Lambda function for infrastructure issues, including the exact event shape its trigger sends to the handler.

| Input | Type | Required |
|---|---|---|
| `function` | string | yes — function name as it appears in your codebase |

**Returns**

- File path of the function
- Every service and table the function accesses, with edge type (`query`, `scan`, `put`, etc.)
- **Triggers** — the trigger source (SQS, SNS, EventBridge, S3, DynamoDB Streams, etc.) with the exact `event` object shape the handler receives. For SQS: `event.Records[0].body`. For S3: `event.Records[0].s3.object.key`. For EventBridge: rule name and event pattern.
- Related findings scoped to this function
- Deduplicated recommendations

**When to call:** Before writing or reviewing any Lambda handler. Always call this first to get the correct event shape — the trigger type determines how you access the payload, and getting it wrong produces silent failures. Also call when a function touches a database or queue you want to verify.

**Example:** If `processOrder` is triggered by SQS, this returns that the handler receives `event.Records[0].body` as the message body, not `event.body`.

---

## suggest_gsi

Returns a ready-to-use GSI definition for a DynamoDB table, scoped to a specific attribute you want to query on.

| Input | Type | Required |
|---|---|---|
| `table` | string | yes |
| `attribute` | string | yes — the attribute to use as GSI partition key |

**Returns**

- Index name (follows your project's naming convention)
- Partition key and projection type
- Billing mode (matches the table's existing mode)
- Rationale for the key choice
- Ready-to-apply recommendation

**When to call:** When a query pattern needs a GSI that doesn't exist, or when the analyzer flags a missing GSI. Always check `get_infra_overview` first to confirm the GSI doesn't already exist on the table.

---

## postgres_index_suggestions

Returns an exact, ready-to-run `CREATE INDEX` statement for a PostgreSQL table and column.

| Input | Type | Required |
|---|---|---|
| `table` | string | yes |
| `column` | string | yes |

**Returns**

- `CREATE INDEX CONCURRENTLY` statement (safe for production — doesn't lock the table)
- Partial index variant for selective queries
- Reminder to run `ANALYZE` after creation

**When to call:** When the analyzer flags a missing index, or when you're writing a query that filters or sorts on a column that isn't indexed. Use `CONCURRENTLY` in production to avoid locking.

---

## suggest_mongo_index

Returns an exact `createIndex` command for a MongoDB collection and field.

| Input | Type | Required |
|---|---|---|
| `collection` | string | yes |
| `field` | string | yes — supports dot notation for nested fields, e.g. `address.city` |

**Returns**

- `db.collection.createIndex(...)` command
- Compound index variant for multi-field queries
- Text index variant for full-text search use cases
- `explain()` query to verify index usage after creation

**When to call:** When a collection query lacks an index, a collection scan is flagged, or you're adding a new query pattern to a collection.

---

## mysql_index_suggestions

Returns an exact `ALTER TABLE` statement to add an index to a MySQL table and column.

| Input | Type | Required |
|---|---|---|
| `table` | string | yes |
| `column` | string | yes |

**Returns**

- `ALTER TABLE ... ADD INDEX` statement
- Composite index variant if multiple columns are commonly filtered together
- `EXPLAIN` query to confirm the index is used

**When to call:** When the analyzer flags a missing MySQL index or a full table scan, or when writing a query that filters on an unindexed column.

---

## get_queue_details

Returns all SQS queues with their operational metadata and security posture.

No inputs required.

**Returns**

Per queue:
- Name and provider
- DLQ status — whether a dead-letter queue is configured
- Encryption status
- Approximate message count
- Retention period in days
- Any associated findings

**When to call:** When reviewing messaging architecture, debugging a backlog, checking DLQ coverage before deploying a consumer, or verifying retention settings meet compliance requirements.

---

## get_topic_details

Returns all SNS topics with subscription metadata and filter policies.

No inputs required.

**Returns**

Per topic:
- Name, provider, subscription count, encryption status
- `filterPolicies` — array of `{ subscriptionArn, protocol, requiredAttributes, scope }` per subscription. `requiredAttributes` lists every message attribute key that subscription requires — any publish call that omits one of these attributes will have its message **silently dropped** by that subscription.

**When to call:** Before writing any SNS publish call. Check `requiredAttributes` on the target topic — if you don't include all of them as `MessageAttributes` in your publish, affected subscriptions will drop the message with no error, no retry, and no DLQ entry.

:::caution
Missing `MessageAttributes` in an SNS publish silently drops the message for filtered subscriptions. There is no error thrown and no DLQ entry. Always check filter policies before publishing.
:::

---

## get_secrets_overview

Returns all Secrets Manager secrets with rotation status. Secret **values are never included**.

No inputs required.

**Returns**

Per secret:
- Name and provider
- Rotation enabled (true/false)
- Rotation interval in days
- Any associated findings

**When to call:** When checking which secrets exist before writing code that reads them, or when verifying rotation is configured for compliance. Use this to get the secret name — never hardcode it.

---

## get_parameter_overview

Returns all SSM Parameter Store parameters with names, types, and tiers. Parameter **values are never included**.

No inputs required.

**Returns**

Per parameter:
- Name and provider
- Type: `String`, `SecureString`, or `StringList`
- Tier: `Standard` or `Advanced`

**When to call:** When checking which config parameters exist for a service, or confirming the exact parameter path before referencing it in code.

---

## get_lambda_overview

Returns all Lambda functions with configuration metadata and their event source triggers.

No inputs required.

**Returns**

Per function:
- Name, runtime, memory (MB), timeout (seconds)
- Environment variable key names (values never included)
- **Triggers** — source type, source name, and the correct handler event shape. S3-triggered Lambdas show `event.Records[0].s3.object.key`. Includes all trigger types: SQS, SNS, DynamoDB Streams, Kinesis, MSK, EventBridge, S3.
- Any associated findings

**When to call:** When reviewing Lambda configuration for default memory (128 MB flags a finding), high timeouts, or checking what triggers a function before writing its handler. Also use this as a quick scan when `get_infra_overview` flags Lambda findings.

---

## get_eventbridge_details

Returns all EventBridge rules with their schedule or event pattern and the Lambda functions they target.

No inputs required.

**Returns**

Per rule:
- Name and state (`ENABLED` / `DISABLED`)
- `scheduleExpression` — for rate/cron-based rules (e.g. `rate(5 minutes)`, `cron(0 12 * * ? *)`)
- `eventPattern` — for event-driven rules, the JSON pattern that triggers the rule
- Target Lambda function names

**When to call:** When checking what schedules or events trigger which Lambda functions, verifying a rule is enabled, or reviewing event patterns before writing a publisher that needs to match them.

---

## get_s3_overview

Returns all S3 buckets with versioning, encryption, public access configuration, and security findings.

No inputs required.

**Returns**

Per bucket:
- Name and provider
- `versioned` — whether versioning is enabled
- `encrypted` — whether server-side encryption is configured
- `publicAccessBlocked` — whether the public access block is active
- Any associated findings

**When to call:** When checking which buckets exist before writing upload or delete handlers, reviewing bucket security posture, or confirming public access is blocked before assuming bucket contents are private.

:::caution
Check `publicAccessBlocked` before assuming a bucket's contents are private. A bucket without this flag set is potentially publicly readable depending on its bucket policy.
:::

---

## get_log_errors

Returns recent error patterns from CloudWatch log groups. Raw log messages are **never included** — only aggregated patterns.

| Input | Type | Required |
|---|---|---|
| `logGroup` | string | no — filters by name substring; omit to return all groups |

**Returns**

Per log group:
- Name and retention period in days (missing retention = no auto-expiry = cost risk)
- Error count
- Top error patterns with frequency — the recurring message shapes, not raw log lines

**When to call:** When investigating a production error, checking which log groups have no retention policy configured, or getting a baseline of error frequency before and after a deployment.
