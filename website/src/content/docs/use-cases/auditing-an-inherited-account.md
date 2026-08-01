---
title: Auditing an AWS account you inherited
description: Infrawise produces one severity-ranked report across security posture, IaC drift, and cost signals — the three questions you have to answer about infrastructure you did not create.
---

Taking over an account means answering three questions with no institutional memory to lean on: what is running that nobody declared, what is exposed, and what is being paid for without being used. Answering them by hand means one console tab per service and a spreadsheet. Infrawise answers all three from a single `infrawise analyze` run and ranks the results by severity.

## What you get

**The infrastructure nobody declared.** IaC drift findings split into two lists: resources running in the account with no Terraform, CloudFormation, or CDK definition behind them — created by hand, unreproducible, invisible to your deploy pipeline — and definitions that were never deployed at all.

**The posture, across every service at once.** S3 buckets with public access blocking disabled, queues without encryption, secrets with rotation switched off, RDS instances that are publicly accessible or lack deletion protection or backups, cache clusters without transit encryption. One report rather than six consoles.

**Cost signals with the evidence attached.** DynamoDB tables on provisioned capacity, Lambdas configured at 3 GB that have never once throttled, cache clusters carrying more nodes than they need. These are advisory signals derived from configuration — infrawise reads no billing API — so treat them as leads, not invoices.

## How to use it

**Run the full report:**

```bash
infrawise analyze
```

Prints every finding grouped by severity, with a recommendation per finding, and caches the graph for the MCP server. Add `--output report.md` for a Markdown artifact you can attach to the audit.

**Then interrogate the parts that matter:**

```
get_s3_overview()
get_secrets_overview()
get_cache_overview()
```

Each returns the resources with their posture fields and any findings attached. Values are never read — infrawise never calls `GetSecretValue`, never reads cached data, and never reads raw log messages.

**Check what the stacks expose to each other:**

```
get_stack_outputs()
```

Returns outputs and cross-stack exports parsed from the local IaC files, including `Export.Name` — what you need when untangling which stack depends on which.

## Why this matters

An inherited account is a liability until it is mapped. The drift list tells you what your pipeline does not control, the posture findings tell you what is exposed while you decide, and the cost signals tell you what you are paying for in the meantime — all before you have earned enough context to make architectural changes safely.
