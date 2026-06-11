---
title: MCP tools reference
description: All 15 MCP tools exposed by Infrawise — inputs, return shape, and when to call each one.
---

Infrawise exposes 15 tools via MCP. Run `infrawise start` to analyze and write `.mcp.json`.

## get_infra_overview

**Start here.** Compact snapshot of everything. No inputs required.

Returns: summary counts, list of databases/services/buckets, high-severity findings with recommendations.

**When to call:** At the start of any database or infrastructure task.

---

## get_graph_summary

Full graph: every node, every edge, all findings. No inputs required.

---

## analyze_function

Analyze a single function including trigger event shapes.

| Input | Type | Required |
|---|---|---|
| `function` | string | yes |

Returns: file path, services/tables accessed, **triggers** with correct handler event shape, related findings.

**When to call:** Before writing or reviewing any Lambda handler.

---

## suggest_gsi

Ready-to-use GSI definition for a DynamoDB table.

| Input | Type | Required |
|---|---|---|
| `table` | string | yes |
| `attribute` | string | yes |

---

## postgres_index_suggestions

| Input | Type | Required |
|---|---|---|
| `table` | string | yes |
| `column` | string | yes |

Returns: `CREATE INDEX CONCURRENTLY` statement, partial index variant, ANALYZE reminder.

---

## suggest_mongo_index

| Input | Type | Required |
|---|---|---|
| `collection` | string | yes |
| `field` | string | yes |

---

## mysql_index_suggestions

| Input | Type | Required |
|---|---|---|
| `table` | string | yes |
| `column` | string | yes |

---

## get_queue_details

All SQS queues with operational metadata. No inputs.

---

## get_topic_details

All SNS topics. No inputs. Check `requiredAttributes` before writing any SNS publish call — missing them silently drops the message.

---

## get_secrets_overview

All Secrets Manager secrets — rotation status only. **Values never included.** No inputs.

---

## get_parameter_overview

All SSM parameters — names and types only. **Values never included.** No inputs.

---

## get_lambda_overview

All Lambda functions with config and event source triggers. No inputs.

---

## get_eventbridge_details

All EventBridge rules. No inputs.

---

## get_s3_overview

All S3 buckets with security configuration. No inputs.

---

## get_log_errors

Recent error patterns from CloudWatch. **Raw log messages never included.**

| Input | Type | Required |
|---|---|---|
| `logGroup` | string | no — filters by name substring |
