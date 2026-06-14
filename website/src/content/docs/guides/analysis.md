---
title: Analysis capabilities
description: What Infrawise's 29 rule-based analyzers detect across AWS services, PostgreSQL, MySQL, MongoDB, and IaC sources — with severity levels and actionable recommendations.
---

An "analysis" in Infrawise means: connect to your configured services using read-only API calls, extract resource metadata into an in-memory graph, then run 29 rule-based analyzers against that graph. Each analyzer checks for a specific misconfiguration, missing resource, or deviation from operational best practice. Results are classified as `high`, `medium`, or `low` severity and surfaced as findings with specific recommendations.

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
| DynamoDB | Missing GSIs for common query patterns | Without a GSI, queries on non-key attributes fall back to full table scans — high cost and high latency at scale. |
| DynamoDB | IaC drift — live table definition differs from Terraform/CloudFormation/CDK source | Drift means your IaC no longer matches production; the next `terraform apply` or stack update could overwrite manual changes or fail unexpectedly. |
| SQS | Missing dead-letter queues (DLQs) | Without a DLQ, failed messages are silently discarded after the maximum receive count — you lose visibility into processing errors. |
| SQS | Visibility timeout less than Lambda timeout | If the visibility timeout is shorter than the consumer Lambda's execution time, SQS re-delivers the message while the original invocation is still running — causing duplicate processing. The timeout should be at least 6× the Lambda timeout. |
| Lambda | Default 128 MB memory | The 128 MB default is almost always too low for production workloads; it also limits CPU allocation, increasing execution time and cost. |
| Lambda | Timeout above 300 seconds | Timeouts above 300s indicate the function may be doing work that belongs in a background job; it also increases the blast radius of runaway executions. |
| Secrets Manager | Rotation disabled | Secrets that never rotate are a persistent credential-exposure risk; rotation should be enabled and tested for all production secrets. |
| CloudWatch Logs | Missing retention policy | Log groups with no retention policy grow indefinitely, increasing storage costs and making incident investigation harder. |
| S3 | Missing versioning | Without versioning, accidental deletes or overwrites are unrecoverable. |
| S3 | Public access not blocked | A bucket with public access not explicitly blocked can expose data if a policy or ACL is misconfigured. |
| S3 | Missing encryption | Buckets without server-side encryption store objects in plaintext — a compliance and security risk for sensitive data. |

## Database analyzers

| Database | What's checked | Why it matters |
|---|---|---|
| PostgreSQL | Missing indexes on common filter columns | Queries that filter on unindexed columns require full sequential scans — slow at scale and expensive on large tables. |
| MySQL | Missing indexes, full table scan risk | Same as PostgreSQL: missing indexes on filter columns mean every query scans the full table rather than walking an index. |
| MongoDB | Missing indexes, collection scans | MongoDB collection scans read every document in the collection for each query — performance degrades linearly as the collection grows. |

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
