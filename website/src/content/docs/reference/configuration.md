---
title: Configuration reference
description: Complete reference for infrawise.yaml — the config file that tells Infrawise which AWS region, databases, and IaC sources to scan. Includes all keys, defaults, and environment variable substitution.
---

`infrawise.yaml` is the single config file that tells Infrawise what to scan: which AWS profile and region to use, which services to extract, and which databases to connect to. Infrawise reads this file at startup every time a command runs.

`infrawise start` generates this file automatically on its first run by probing your environment. To answer the questions yourself instead of auto-discovery, pass `--interactive`. Or create it manually using the schema below.

Every service must be explicitly `enabled: true` — Infrawise never connects to anything not enabled in config.

## Minimal configuration (AWS only)

```yaml
project: my-service
aws:
  profile: default # AWS profile from ~/.aws; omit to use the default credential chain
  region: us-east-1
dynamodb:
  enabled: true
```

## Full schema

```yaml
project: payments-service # required

aws:
  profile: default # named profile from ~/.aws/config; '' = default credential chain
  region: us-east-1

dynamodb:
  enabled: true
  includeTables: [] # omit or leave empty to include all tables

postgres:
  enabled: false
  connectionString: postgresql://infrawise_ro:${DB_PASSWORD}@host:5432/mydb

mysql:
  enabled: false
  connectionString: ''

mongodb:
  enabled: false
  connectionString: ''
  databases: [] # limit to specific databases

terraform:
  enabled: true # also covers CloudFormation and CDK (local file parsing)

sqs:
  enabled: true

sns:
  enabled: true

ssm:
  enabled: true
  paths: [] # filter by prefix, e.g. ["/myapp/prod"]

secretsManager:
  enabled: true

lambda:
  enabled: true
  includeFunctions: [] # omit or leave empty to include all functions

eventbridge:
  enabled: true

rds:
  enabled: false

s3:
  enabled: false

apiGateway:
  enabled: false

cognito:
  enabled: false

kinesis:
  enabled: false

msk:
  enabled: false

elasticache:
  enabled: false

runtimeSignals:
  enabled: false # Lambda throttles/errors + queue age via CloudWatch metrics
  windowHours: 24

cloudwatchLogs:
  enabled: false
  logGroupPrefixes: []
  windowHours: 24

analysis:
  sampleSize: 100
  hotPartitionThreshold: 5
  hotPartitionThresholds: # per-table overrides
    high-traffic-table: 12
```

## Key explanations

**`aws`** controls which AWS account and region Infrawise scans. `profile` selects a named profile from `~/.aws/config`; leave it empty to use the default credential chain (environment variables, `~/.aws/credentials`, instance profile).

**Service keys** (`dynamodb`, `sqs`, `sns`, `ssm`, `secretsManager`, `lambda`, `eventbridge`, `rds`, `s3`, `apiGateway`, `cognito`, `kinesis`, `msk`, `elasticache`, `cloudwatchLogs`) each take `enabled: true|false`. Disabled services are never contacted, and their MCP tools are reported as off by `infrawise serve`.

**Database keys** (`postgres`, `mysql`, `mongodb`) take a connection string. Infrawise reads table/collection names, column definitions, and index configurations — it never queries row data. Connection strings support `${ENV_VAR}` substitution (see below), and can also live in `.infrawise/secrets.yaml` outside version control.

**`terraform`** enables local IaC file parsing — Terraform, CloudFormation, and CDK — for drift detection against live AWS state and for stack output / cross-stack export extraction.

**`runtimeSignals`** (opt-in) fetches CloudWatch metrics for the analysis window: Lambda throttle and error counts, and the age of the oldest message per SQS queue. Powers the throttling and stale-queue findings.

**`analysis`** tunes code-correlation analysis: `sampleSize` for schema sampling, `hotPartitionThreshold` for how many distinct code paths on one table trigger the hot-partition finding (overridable per table).

## Environment variable substitution

Any value in `infrawise.yaml` can reference an environment variable using `${VAR_NAME}` syntax:

```yaml
connectionString: postgresql://infrawise_ro:${DB_PASSWORD}@host:5432/mydb
```

Infrawise resolves environment variables at startup. References to unset variables are left as-is, so a missing variable shows up as a connection error for that database rather than a config failure.

:::tip
Never commit database passwords to `infrawise.yaml`. Use `${ENV_VAR}` substitution, or put connection strings in `.infrawise/secrets.yaml` — `infrawise start` adds `.infrawise/` to your `.gitignore`.
:::

---

## FAQ

### Where does Infrawise look for the config file?

By default, Infrawise looks for `infrawise.yaml` in the current working directory. Override this with the `--config <path>` flag on any command that accepts it (`start`, `analyze`, `check`, `serve`).

### Can I have multiple config files?

Yes. Create separate `infrawise.yaml` files per environment or AWS account and use `--config` to select the one you want:

```bash
infrawise analyze --config infrawise.prod.yaml
infrawise start --claude --config infrawise.staging.yaml
```

### What happens if a database or service is unreachable?

Infrawise logs a warning for the unreachable service and continues. Every extractor is independent — one failing service never aborts the whole analysis. The affected MCP tools return empty results. Run `infrawise doctor` to diagnose connectivity issues before starting a session.
