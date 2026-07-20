---
title: Reviewing AWS security posture from your editor
description: Infrawise surfaces security and operational findings across Secrets Manager, CloudWatch Logs, S3, and Lambda — so Claude Code can identify gaps without you leaving your editor.
---

Security reviews of AWS accounts usually require switching between the console, CLI, and a spreadsheet. Infrawise runs a set of rule-based checks across your account every time you run `infrawise analyze`, and exposes the findings through MCP so your AI coding assistant can query them during a normal development session.

## What Infrawise checks

### Secrets Manager

**Rotation not enabled — medium severity**

Any Secrets Manager secret without automatic rotation configured is flagged at medium severity. Long-lived credentials increase the blast radius of a compromise. The finding names the specific secret and recommends enabling a Lambda-based rotation function. AWS provides pre-built rotators for RDS, Redshift, and custom secrets.

### CloudWatch Logs

**No retention policy — medium severity**

Log groups with no retention policy set retain logs indefinitely. Infrawise flags these at medium severity. Indefinite retention increases storage costs and can keep sensitive data accessible longer than intended. The finding recommends a 90-day baseline, with longer periods for compliance requirements like SOC2 or PCI.

**Retention over 365 days — low severity**

Log groups with a retention period exceeding 365 days are flagged at low severity. Unless required by compliance, very long retention periods may be higher than necessary.

### S3

**Public access blocking disabled — surfaces for review**

When an S3 bucket has public access blocking disabled, Infrawise surfaces it for manual review. The finding notes that this is expected for static website hosting and public asset buckets, and asks you to confirm the configuration is intentional before treating it as a security issue. It is not automatically classified as a vulnerability.

**Versioning not enabled — medium severity**

Buckets without versioning are flagged at medium severity. Without versioning, accidental deletes or overwrites are unrecoverable. Versioning is also required for cross-region replication and S3 Object Lock.

**No server-side encryption — medium severity**

Buckets with no explicit SSE configuration are flagged at medium severity. AWS has enabled SSE-S3 by default for new buckets since January 2023, but older buckets or those without an explicit configuration should be verified.

### Lambda

**Default 128 MB memory — low severity**

Lambda functions running at the default 128 MB are flagged at low severity. Undersized memory limits CPU allocation and increases duration. Because Lambda pricing is duration × memory, increasing memory often reduces cost by shortening execution time. The finding recommends running Lambda Power Tuning to find the optimal configuration.

**Timeout at or above 300 seconds — low severity**

Lambda functions with a timeout of 300 seconds or higher are flagged at low severity. High timeouts mask latency problems and increase worst-case cost when functions hang. The finding recommends reviewing whether the timeout is necessary and adding internal circuit-breakers.

## How to use it

**Get a full security overview in one call:**

```
get_infra_overview()
```

Returns all high and medium severity findings. Secrets rotation, log retention, S3 versioning, and S3 encryption findings all appear here.

**Drill into specific services:**

```
get_secrets_overview()     // rotation status per secret
get_s3_overview()          // versioning, encryption, public access per bucket
get_lambda_overview()      // memory, timeout, trigger config per function
get_log_errors()           // retention days and error patterns per log group
```

Each tool returns the relevant security metadata alongside operational data.

---

## FAQ

### Does Infrawise flag S3 public access as a critical issue?

No. Infrawise surfaces S3 public access blocking as something to review and confirm, not as a definitive security violation. Public access is intentional for static website hosting and CDN origin buckets. The finding asks you to verify the configuration matches your intent.

### Are secret values ever returned?

Never. `get_secrets_overview` returns only secret names, rotation status, and findings. Secret values, SSM parameter values, and Lambda environment variable values are never included in any Infrawise response.

### How often does Infrawise re-scan?

Infrawise scans on each `infrawise analyze` run or `infrawise start`. It does not run continuously. Results are cached for the current session.

### What IAM permissions does Infrawise need for these checks?

Infrawise uses read-only APIs: `secretsmanager:ListSecrets`, `logs:DescribeLogGroups`, `s3:GetBucketVersioning`, `s3:GetBucketEncryption`, `s3:GetPublicAccessBlock`, `lambda:ListFunctions`. See the [AWS setup](/infrawise/getting-started/aws-setup/) page for the full minimum IAM policy, including how to scope it to only the services you use.
