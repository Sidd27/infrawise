---
title: Analysis capabilities
description: What Infrawise's 36 rule-based analyzers detect across AWS services, PostgreSQL, MySQL, MongoDB, and IaC sources — with severity levels and actionable recommendations.
---

An "analysis" in Infrawise means: connect to your configured services using read-only API calls, extract resource metadata into an in-memory graph, then run 36 rule-based analyzers against that graph. Each analyzer checks for a specific misconfiguration, missing resource, or deviation from operational best practice. Results are classified as `high`, `medium`, or `low` severity and surfaced as findings with specific recommendations.

Your AI assistant can query these findings via MCP tools like `get_infra_overview` and `get_graph_summary`, or ask for function-level analysis with `analyze_function`. See the [MCP tools reference](/infrawise/reference/mcp-tools/) for the full tool list.

## Severity levels

| Severity | Meaning |
|---|---|
| `high` | Likely to cause data loss, outage, or security exposure. Fix before shipping. |
| `medium` | Operational risk or reliability gap that should be addressed soon. |
| `low` | Best-practice deviation with low immediate impact. Worth fixing in a planned cleanup. |

Use the `--severity` flag on `infrawise analyze` or `infrawise start` to filter findings to a minimum level. The `analysis.severity` key in `infrawise.yaml` sets the default.

## AWS analyzers

| Service | What's checked | Why it matters |
|---|---|---|
| DynamoDB | Full table scan detected in code | A `Scan` reads every item in the table on every invocation — the highest-leverage place to fix, since cost scales with traffic. |
| DynamoDB | Missing GSIs for common query patterns | Without a GSI, queries on non-key attributes fall back to full table scans — high cost and high latency at scale. |
| DynamoDB | Hot partition — 5+ distinct code paths accessing one table | High access concentration on one partition key risks throttling at scale; the finding recommends write sharding or DAX for read-heavy workloads. |
| DynamoDB | IaC drift — live table definition differs from Terraform/CloudFormation/CDK source | Drift means your IaC no longer matches production; the next `terraform apply` or stack update could overwrite manual changes or fail unexpectedly. |
| DynamoDB | Cost signal: provisioned capacity (advisory) | On-demand may cost less under spiky traffic, provisioned is usually cheaper under steady traffic — no billing API involved, just a config heuristic. |
| SQS | Missing dead-letter queues (DLQs) | Without a DLQ, failed messages are silently discarded after the maximum receive count — you lose visibility into processing errors. |
| SQS | Lambda triggered by a queue with no DLQ | The more dangerous variant: failed Lambda invocations from this trigger have nowhere to route. |
| SQS | Unencrypted queue | Messages without server-side encryption sit in plaintext at rest. |
| SQS | Backlog over 1,000 messages | A growing backlog typically means consumers are falling behind, scaled incorrectly, or failing silently. |
| SQS | Visibility timeout less than Lambda timeout | If the visibility timeout is shorter than the consumer Lambda's execution time, SQS re-delivers the message while the original invocation is still running — causing duplicate processing. The timeout should be at least 6× the Lambda timeout. |
| SQS (runtime signals, opt-in) | Oldest message older than one hour | Stale messages mean consumers are failing, falling behind, or not running — and messages near the retention limit get silently dropped. |
| SQS/SNS/Lambda/DynamoDB (pipeline analyzer) | Mid-pipeline queue with no DLQ, full scan inside an event-triggered Lambda, or one table read redundantly across multiple pipeline stages | These cross-service checks trace producer→consumer chains inferred from IaC and code, catching issues that a single-resource check would miss. |
| Lambda | Default 128 MB memory | The 128 MB default is almost always too low for production workloads; it also limits CPU allocation, increasing execution time and cost. |
| Lambda | Timeout above 300 seconds | Timeouts above 300s indicate the function may be doing work that belongs in a background job; it also increases the blast radius of runaway executions. |
| Lambda | Execution role missing a permission the code actually uses | Comparing IAM role permissions against services the function's code calls catches a runtime `AccessDenied` before it ships. |
| Lambda | Cost signal: high memory (3008 MB+) with zero recent throttles | One signal (not proof) that the function may be over-provisioned; Lambda Power Tuning can find the cost-optimal size. Without runtime signals enabled, this is advisory only. |
| Lambda (runtime signals, opt-in) | Recent throttling from CloudWatch metrics | Throttled invocations are rejected or delayed — sync callers see errors, event sources build backlogs. |
| Secrets Manager | Rotation disabled | Secrets that never rotate are a persistent credential-exposure risk; rotation should be enabled and tested for all production secrets. |
| CloudWatch Logs | Missing retention policy | Log groups with no retention policy grow indefinitely, increasing storage costs and making incident investigation harder. |
| S3 | Missing versioning | Without versioning, accidental deletes or overwrites are unrecoverable. |
| S3 | Public access not blocked | A bucket with public access not explicitly blocked can expose data if a policy or ACL is misconfigured. |
| S3 | Missing encryption | Buckets without server-side encryption store objects in plaintext — a compliance and security risk for sensitive data. |
| RDS | Publicly accessible | A publicly reachable database is exposed to brute-force and credential-stuffing attacks from the internet. |
| RDS | Automated backups disabled | With zero backup retention, accidental deletion or corruption is unrecoverable without a manual snapshot. |
| RDS | Unencrypted storage | Data at rest — including backups and read replicas — is stored unencrypted. |
| RDS | Deletion protection disabled | The instance can be dropped without any safeguard against a mistaken `terraform destroy` or human error. |
| RDS | Single-AZ (no Multi-AZ) | An AZ outage causes downtime until the instance recovers in the same AZ; Multi-AZ gives automatic failover. |
| RDS | Cost signal: Multi-AZ enabled on a dev/staging/test/sandbox-looking instance name | Multi-AZ roughly doubles RDS cost — often unnecessary outside production. |
| ElastiCache | Missing in-transit encryption | Without TLS, credentials and cached data cross the network in plaintext. |
| ElastiCache | Single node with no replication | A node failure loses all cached data and takes the cache offline until replaced. |
| ElastiCache | Cost signal: more than 3 nodes (advisory) | Verify traffic actually justifies N× the per-node cost — no billing API involved. |

## Database analyzers

| Database | What's checked | Why it matters |
|---|---|---|
| PostgreSQL | Missing indexes on common filter columns | Queries that filter on unindexed columns require full sequential scans — slow at scale and expensive on large tables. |
| PostgreSQL | N+1 query pattern | Looping a per-row query instead of one batched query multiplies round trips linearly with result size. |
| PostgreSQL | `SELECT *` on a wide table | Pulling every column when only a few are used wastes bandwidth and defeats covering indexes. |
| MySQL | Missing indexes | Queries that filter on unindexed columns mean every query scans the full table rather than walking an index. |
| MySQL | Full table scan risk | Same failure mode as a missing index, flagged directly when a scan pattern is detected in code. |
| MongoDB | Missing indexes | Missing indexes mean every query on that field triggers a collection scan. |
| MongoDB | Collection scans | MongoDB collection scans read every document in the collection for each query — performance degrades linearly as the collection grows. |

Infrawise detects missing indexes by inspecting existing index definitions against the query patterns it observes in your connected Lambda function source code via AST scanning. It never reads actual data rows or documents.

## IaC analyzers

| Source | What's checked | Why it matters |
|---|---|---|
| Terraform | Drift between `.tf` definitions and live AWS state | Live resources that differ from their Terraform definitions will be overwritten or recreated on the next `terraform apply`. |
| CloudFormation | Drift between template definitions and live AWS state | Same risk: stack updates will attempt to reconcile live state back to the template, potentially destroying manual changes. |
| CDK | Drift between CDK stack files and live AWS state | CDK synthesizes to CloudFormation; drift in CDK source carries the same reconciliation risk on the next `cdk deploy`. |

---

## FAQ

### What is IaC drift?

IaC drift is when the live state of an AWS resource — as it actually exists in your account — differs from how it is defined in your infrastructure-as-code source (Terraform, CloudFormation, or CDK). Drift happens when someone manually changes a resource in the AWS console or via the CLI without updating the IaC source. Infrawise compares the two and flags the differences so you can reconcile them before the next deployment overwrites the manual change.

### How does Infrawise detect missing indexes?

For DynamoDB, Infrawise reads the table's GSI list from the AWS API and cross-references it against the access patterns it finds in your Lambda source code via AST scanning. For PostgreSQL, MySQL, and MongoDB, Infrawise reads the schema metadata (column definitions and existing index definitions) from each connected database. It never reads row data or executes queries against your data.

### How do I suppress a finding I don't care about?

Currently, Infrawise does not have a built-in suppression list. The recommended approach is to use `--severity high` or `analysis.severity: high` in `infrawise.yaml` to filter out lower-severity findings you have consciously accepted. Per-rule suppression is on the roadmap — contributions welcome at [github.com/Sidd27/infrawise](https://github.com/Sidd27/infrawise).
