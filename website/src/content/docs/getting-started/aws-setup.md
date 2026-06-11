---
title: AWS setup
description: Minimum IAM policy required for Infrawise to read your AWS infrastructure metadata — DynamoDB, Lambda, SQS, SNS, S3, Secrets Manager, SSM, CloudWatch Logs, RDS, and EventBridge.
---

Infrawise reads AWS resource metadata — table definitions, queue configurations, Lambda settings, secret rotation status — using standard AWS SDK read-only API calls. It never reads the actual data inside those resources: no secret values, no log message content, no S3 object content, no database rows. The IAM policy below grants exactly the calls Infrawise needs and nothing more.

## Minimum IAM policy

Attach this policy to the IAM user or role Infrawise uses:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "lambda:ListFunctions",
        "lambda:GetFunction",
        "lambda:ListEventSourceMappings",
        "sqs:ListQueues",
        "sqs:GetQueueAttributes",
        "sns:ListTopics",
        "sns:GetTopicAttributes",
        "sns:ListSubscriptionsByTopic",
        "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret",
        "ssm:DescribeParameters",
        "s3:ListAllMyBuckets",
        "s3:GetBucketVersioning",
        "s3:GetBucketEncryption",
        "s3:GetPublicAccessBlock",
        "events:ListRules",
        "events:ListTargetsByRule",
        "logs:DescribeLogGroups",
        "logs:FilterLogEvents",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters"
      ],
      "Resource": "*"
    }
  ]
}
```

## What Infrawise never reads

Infrawise is strictly a metadata reader. The following are never accessed, regardless of IAM permissions granted:

- **Secret values** — `secretsmanager:GetSecretValue` is not called; Infrawise only reads rotation status and metadata via `DescribeSecret`
- **SSM parameter values** — `ssm:GetParameter` is not called; Infrawise only reads parameter names and types via `DescribeParameters`
- **Log message content** — `logs:FilterLogEvents` is called only to count error patterns; raw log text is never returned to your AI assistant
- **S3 object content** — Infrawise reads bucket-level config (versioning, encryption, public access block) only; no `GetObject` calls are made
- **Database rows** — for connected databases (PostgreSQL, MySQL, MongoDB), Infrawise reads schema metadata only — table names, column names, index definitions — not row data

:::tip
You can verify what calls Infrawise makes by running `infrawise doctor`, which validates connectivity and lists the services it can reach.
:::

## Restricting by resource ARN

The policy above uses `"Resource": "*"` for simplicity. In production you can tighten it to specific resource ARNs. For example, to restrict DynamoDB access to a single table:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:ListTables",
    "dynamodb:DescribeTable"
  ],
  "Resource": [
    "arn:aws:dynamodb:us-east-1:123456789012:table/orders",
    "arn:aws:dynamodb:us-east-1:123456789012:table/users"
  ]
}
```

:::caution
`dynamodb:ListTables` and `s3:ListAllMyBuckets` do not support resource-level restrictions — they require `"Resource": "*"`. Scope the remaining actions by ARN and leave those two as wildcard.
:::

## Using a named AWS profile

If you use named AWS profiles, specify the profile in `infrawise.yaml`:

```yaml
services:
  aws:
    region: us-east-1
    profile: infrawise-readonly
```

Infrawise passes the profile name to the AWS SDK credential chain. The profile must exist in `~/.aws/config` or `~/.aws/credentials`.

## LocalStack (no AWS account needed)

See the [LocalStack demo guide](/infrawise/guides/localstack-demo/) to run Infrawise against emulated AWS services locally — no real AWS account or credentials required.

---

## FAQ

### Does Infrawise read my database data?

No. For connected databases (PostgreSQL, MySQL, MongoDB), Infrawise reads schema metadata only: table and collection names, column definitions, and index configurations. It never queries rows, documents, or any stored data.

### Does Infrawise need cross-account access?

No. Infrawise operates in a single AWS account at a time, using the credentials or profile specified in `infrawise.yaml`. If you need to inspect multiple accounts, create a separate `infrawise.yaml` per account and run `infrawise start --config` pointing to each one.

### How do I verify the permissions are correct?

Run `infrawise doctor` from the directory containing your `infrawise.yaml`. It validates AWS credential resolution, tests connectivity to each configured service, and reports which services are reachable. Any permission errors surface as specific missing-action messages.
