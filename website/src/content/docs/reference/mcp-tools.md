---
title: MCP tools reference
description: All 21 MCP tools exposed by Infrawise — inputs, return shape, when to call, and common patterns.
---

Infrawise exposes **21 MCP tools** via a local stdio or HTTP server. Run `infrawise start` once to analyze your infrastructure and write the editor config. After that your editor manages the server — no commands to run between sessions.

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
- `freshness` — `analyzedAt` (ISO timestamp), `ageSeconds`, and a `stale` flag (true past 24h) with a refresh hint
- `configured` — false when the server booted without an `infrawise.yaml` (e.g. a remotely hosted instance with no access to your cloud account or code); every tool then returns empty results and a `setupHint` explains how to run Infrawise locally

**When to call:** At the start of any task that touches infrastructure — adding a Lambda, writing a queue consumer, creating a new index, debugging a deployment issue.

**When NOT to call:** Don't repeat it mid-session unless you've run `infrawise analyze` to refresh the data. The graph is built once per analyze run; calling overview twice returns the same data.

---

## get_graph_summary

Returns the complete infrastructure graph: every node, every edge, and all findings at every severity level. More data than `get_infra_overview` — use it when you need to trace relationships across services.

No inputs required.

**Returns**

- All `nodes` — tables, queues, lambdas, topics, buckets, and more
- All `edges` — typed relationships: `query`, `scan`, `joins`, `uses_index`, `publishes_to`, `subscribes_to`, `reads_secret`, `reads_parameter`, `triggers`
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
- **missingPermissions** — AWS service names the function accesses in code but its execution role doesn't allow (e.g. `["dynamodb", "sqs"]`); present only when IAM role data is available
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
- `isFifo` — whether the queue is a FIFO queue. When `true`, all `SendMessage` calls must include a `MessageGroupId` or the call fails at runtime.
- `visibilityTimeoutSec` — how long a message is hidden after a consumer receives it. Should be at least 6× the consumer Lambda's timeout to prevent duplicate processing.
- Approximate message count
- Retention period in days
- `oldestMessageAgeSec` — age of the oldest message, only when runtime signals are enabled
- Any associated findings (includes `VisibilityTimeoutMismatch` when visibility timeout < Lambda timeout)

**When to call:** When reviewing messaging architecture, debugging a backlog, checking DLQ coverage before deploying a consumer, verifying retention settings, or confirming FIFO queue requirements before writing a producer.

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
- `referencedKeys` — key names (e.g. `"password"`, `"apiKey"`) inferred from application code that parses the secret; `[]` if none detected. Values are never read.
- Any associated findings

**When to call:** When checking which secrets exist before writing code that reads them, or when verifying rotation is configured for compliance. Use `referencedKeys` to get the exact key name instead of guessing `secret.password` vs `secret.passwd`.

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
- `roleArn` — the execution role ARN
- **Triggers** — source type, source name, and the correct handler event shape. S3-triggered Lambdas show `event.Records[0].s3.object.key`. Includes all trigger types: SQS, SNS, DynamoDB Streams, Kinesis, MSK, EventBridge, S3.
- `recentThrottles` / `recentErrors` — CloudWatch counts for the analysis window, only when runtime signals are enabled
- `costSignal` — present when memory is 3008 MB+ and runtime signals are off (not enough evidence for a finding, so it's advisory only); when signals are on and throttles are 0, this becomes a low-severity finding instead — no billing API involved, this is a config-level heuristic
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

---

## get_api_routes

Returns all API Gateway APIs (REST, HTTP, and WebSocket) with their routes, HTTP methods, and Lambda integrations.

No inputs required.

**Returns**

Per API:
- Name and type (`REST`, `HTTP`, or `WEBSOCKET`)
- Routes — each with HTTP method, path, and the Lambda function name it invokes (`null` when no Lambda integration is configured)

**When to call:** Before writing or reviewing any API handler — call this to confirm which Lambda backs a route and what method/path combination it expects. Also use when auditing API surface area for routes with no Lambda integration.

---

## get_stack_outputs

Returns all stack outputs and cross-stack exports parsed from local IaC files — Terraform `output` blocks and CloudFormation/CDK `Outputs` sections.

No inputs required.

**Returns**

Per output:
- Name, description, and the raw value expression
- Export name (CloudFormation/CDK `Export.Name`) when the output is a cross-stack export
- Source (`terraform`, `cloudformation`, or `cdk`) and file path

**When to call:** When wiring cross-stack references (`Fn::ImportValue`, `terraform_remote_state`) or when you need the exported name of a resource defined in another stack. Not for live resource attributes — outputs come from local IaC files, not the deployed stack.

---

## get_cognito_overview

Returns all Cognito user pools with full app client configuration. Client secret values and user data are **never included**.

No inputs required.

**Returns**

Per user pool:
- Name, pool ID, and MFA configuration
- App clients — each with client name/ID, allowed auth flows, OAuth flows/scopes, callback URLs, token validity settings, and whether the client has a secret (`generatesSecret`)

**When to call:** Before writing any Cognito sign-in, sign-up, or token-refresh code — use one of the allowed auth flows, and include `SECRET_HASH` in auth calls when `generatesSecret` is true.

---

## get_stream_details

Returns all Kinesis data streams and Amazon MSK clusters.

No inputs required.

**Returns**

- Streams — name, status, open shard count, retention hours, encryption, and capacity mode (`PROVISIONED` or `ON_DEMAND`)
- Kafka clusters — name, state, cluster type, Kafka version, and broker count

**When to call:** When writing Kinesis producer or consumer code, checking capacity mode before `PutRecord` calls, or reviewing streaming architecture. For Kafka topic-level producer/consumer mappings extracted from application code, use `get_topic_details` instead.

---

## get_cache_overview

Returns all ElastiCache clusters. Cached data is **never read or included**.

No inputs required.

**Returns**

Per cluster:
- ID, engine, engine version, node type, and node count
- In-transit and at-rest encryption status
- Replication group ID and automatic failover state
- `costSignal` — present when a cluster has more than 3 nodes (no billing API, just a node-count heuristic)
- Related findings (missing transit encryption, single-node with no replication)

**When to call:** Before writing cache client code — TLS is required when transit encryption is on (`rediss://` for Redis) — or when reviewing cache availability and security posture.

---

## get_table_schema

Returns column-level schema for specific tables or collections by name. Row data is **never included**.

| Input | Type | Required |
|---|---|---|
| `tables` | string[] (1-20) | yes |

**Returns**

Per requested name — a `found` flag and matches (short names like `orders` match `public.orders`, case-insensitive):
- Columns with data types and nullability (PostgreSQL/MySQL)
- Primary keys and foreign keys — the join paths a query generator needs
- Index names
- DynamoDB partition and sort keys, billing mode (`PROVISIONED` / `PAY_PER_REQUEST`), and provisioned throughput when applicable
- MongoDB estimated document count
- `costSignal` — present on DynamoDB matches with `billingMode: "PROVISIONED"` (advisory, no billing API involved)

Unknown names return up to five suggestions.

**When to call:** After `get_infra_overview`, when you need column-level detail to write a SQL query, DynamoDB expression, or MongoDB filter. This is the progressive-disclosure path for databases with many tables: fetch only the schemas the task needs instead of putting the entire database schema in every prompt.
