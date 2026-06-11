---
title: Analysis capabilities
description: What Infrawise detects and reports across AWS, databases, and IaC.
---

Infrawise runs 23 rule-based analyzers. Findings are classified as `high`, `medium`, or `low` severity.

## AWS analyzers

| Service | What's checked |
|---|---|
| DynamoDB | Missing GSIs for common query patterns, IaC drift |
| SQS | Missing DLQs |
| Lambda | Default 128 MB memory, timeouts above 300s |
| Secrets Manager | Rotation disabled |
| CloudWatch Logs | Missing retention policy |
| S3 | Missing versioning, public access not blocked, missing encryption |

## Database analyzers

| Database | What's checked |
|---|---|
| PostgreSQL | Missing indexes on common filter columns |
| MySQL | Missing indexes, full table scan risk |
| MongoDB | Missing indexes, collection scans |

## IaC analyzers

| Source | What's checked |
|---|---|
| Terraform | Drift between IaC definition and live AWS state |
| CloudFormation | Same drift detection |
| CDK | Same drift detection |
