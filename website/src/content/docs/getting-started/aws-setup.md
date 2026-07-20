---
title: AWS setup
description: Minimum IAM policy required for Infrawise to read your AWS infrastructure metadata, how to scope it to only the services you enable, and how to use a session policy for temporary scoped credentials.
---

Infrawise reads AWS resource metadata — table definitions, queue configurations, Lambda settings, secret rotation status — using standard AWS SDK read-only API calls. It never reads the actual data inside those resources: no secret values, no log message content, no S3 object content, no database rows. The IAM policy below grants exactly the calls Infrawise needs and nothing more.

## Minimum IAM policy

Attach this policy to the IAM user or role Infrawise uses. This is the full policy for every service Infrawise supports — see [Scoping to only the services you use](#scoping-to-only-the-services-you-use) below if you don't need all of them:

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
        "lambda:ListEventSourceMappings",
        "sqs:ListQueues",
        "sqs:GetQueueAttributes",
        "sns:ListTopics",
        "sns:GetTopicAttributes",
        "sns:ListSubscriptionsByTopic",
        "sns:GetSubscriptionAttributes",
        "secretsmanager:ListSecrets",
        "ssm:DescribeParameters",
        "s3:ListAllMyBuckets",
        "s3:GetBucketVersioning",
        "s3:GetBucketEncryption",
        "s3:GetPublicAccessBlock",
        "s3:GetBucketNotification",
        "events:ListRules",
        "events:ListTargetsByRule",
        "logs:DescribeLogGroups",
        "logs:FilterLogEvents",
        "rds:DescribeDBInstances",
        "apigateway:GET",
        "cognito-idp:ListUserPools",
        "cognito-idp:DescribeUserPool",
        "cognito-idp:ListUserPoolClients",
        "cognito-idp:DescribeUserPoolClient",
        "kinesis:ListStreams",
        "kinesis:DescribeStreamSummary",
        "kafka:ListClustersV2",
        "elasticache:DescribeCacheClusters",
        "elasticache:DescribeReplicationGroups",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:GetRolePolicy",
        "iam:GetPolicy",
        "iam:GetPolicyVersion"
      ],
      "Resource": "*"
    }
  ]
}
```

`apigateway:GET` follows API Gateway's own IAM model (HTTP-method-based, not per-call action names) and covers REST, HTTP, and WebSocket API reads. The `iam:*` actions are only needed if you want `analyze_function`'s missing-permission check (comparing what a Lambda's execution role allows against what its code actually calls) — drop them if you don't use that check.

## What Infrawise never reads

Infrawise is strictly a metadata reader. The following are never accessed, regardless of IAM permissions granted:

- **Secret values** — `secretsmanager:GetSecretValue` is not called; rotation status and metadata come from `ListSecrets` alone, which already includes `RotationEnabled`/`RotationRules` in its response — no per-secret `DescribeSecret` call is needed
- **SSM parameter values** — `ssm:GetParameter` is not called; Infrawise only reads parameter names and types via `DescribeParameters`
- **Log message content** — `logs:FilterLogEvents` is called only to count error patterns; raw log text is never returned to your AI assistant
- **S3 object content** — Infrawise reads bucket-level config (versioning, encryption, public access, event notifications) only; no `GetObject` calls are made
- **Cached data** — for ElastiCache, Infrawise reads cluster configuration only; it never connects to the cache itself
- **User data or client secrets** — for Cognito, Infrawise reads pool and app client configuration only; it never reads user records or client secret values
- **Database rows** — for connected databases (PostgreSQL, MySQL, MongoDB), Infrawise reads schema metadata only — table names, column names, index definitions — not row data

:::tip
You can verify what calls Infrawise makes by running `infrawise doctor`, which validates connectivity and lists the services it can reach.
:::

## Scoping to only the services you use

Two independent levers scope Infrawise down — use both together.

**1. `infrawise.yaml` gates which services Infrawise ever calls.** Each service has its own `enabled` flag; if it's off (or omitted), Infrawise never makes that service's API calls, regardless of what IAM allows. To scan only DynamoDB, Lambda, and SQS:

```yaml
project: my-project
aws:
  region: us-east-1
  profile: infrawise-readonly
dynamodb:
  enabled: true
lambda:
  enabled: true
sqs:
  enabled: true
```

**2. Match the IAM policy to the same subset.** Grant only the actions for the services you enabled:

| `infrawise.yaml` key | IAM actions |
|---|---|
| `dynamodb` | `dynamodb:ListTables`, `dynamodb:DescribeTable` |
| `lambda` | `lambda:ListFunctions`, `lambda:ListEventSourceMappings` |
| `sqs` | `sqs:ListQueues`, `sqs:GetQueueAttributes` |
| `sns` | `sns:ListTopics`, `sns:GetTopicAttributes`, `sns:ListSubscriptionsByTopic`, `sns:GetSubscriptionAttributes` |
| `secretsManager` | `secretsmanager:ListSecrets` |
| `ssm` | `ssm:DescribeParameters` |
| `s3` | `s3:ListAllMyBuckets`, `s3:GetBucketVersioning`, `s3:GetBucketEncryption`, `s3:GetPublicAccessBlock`, `s3:GetBucketNotification` |
| `eventbridge` | `events:ListRules`, `events:ListTargetsByRule` |
| `cloudwatchLogs` | `logs:DescribeLogGroups`, `logs:FilterLogEvents` |
| `rds` | `rds:DescribeDBInstances` |
| `apiGateway` | `apigateway:GET` |
| `cognito` | `cognito-idp:ListUserPools`, `cognito-idp:DescribeUserPool`, `cognito-idp:ListUserPoolClients`, `cognito-idp:DescribeUserPoolClient` |
| `kinesis` | `kinesis:ListStreams`, `kinesis:DescribeStreamSummary` |
| `msk` | `kafka:ListClustersV2` |
| `elasticache` | `elasticache:DescribeCacheClusters`, `elasticache:DescribeReplicationGroups` |
| `runtimeSignals` (opt-in) | `cloudwatch:GetMetricData` |

For the DynamoDB/Lambda/SQS example above, that's:

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
        "lambda:ListEventSourceMappings",
        "sqs:ListQueues",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "*"
    }
  ]
}
```

`postgres`, `mysql`, `mongodb`, and `terraform` don't need any IAM at all — they connect directly (connection string / local files), not through AWS.

## Using a session policy for temporary scoped credentials

If Infrawise's underlying IAM role or user has broader permissions than you want it to actually use, assume a role with an inline session policy that further restricts the session to just the actions you need — no changes to the underlying role required:

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/infrawise-broad-role \
  --role-session-name infrawise-scoped \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "lambda:ListFunctions",
        "lambda:ListEventSourceMappings",
        "sqs:ListQueues",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "*"
    }]
  }'
```

The `--policy` argument is a *session policy*: the effective permissions are the intersection of the role's permissions and this policy, never a superset. Write the returned temporary credentials to a named profile (or export them as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`) and point `infrawise.yaml`'s `aws.profile` at it. Infrawise has no credential logic of its own — it goes through the standard AWS SDK credential chain, so an assumed-role session, SSO session, or any other valid credential source works transparently.

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

### Does Infrawise need broad read access, or can I scope it to just the services I use?

You can scope it down. Disable services you don't use in `infrawise.yaml` (Infrawise then never calls those APIs) and grant IAM only for the services you enabled — see [Scoping to only the services you use](#scoping-to-only-the-services-you-use). For temporary, per-session scoping without touching the underlying role, use an [STS session policy](#using-a-session-policy-for-temporary-scoped-credentials); Infrawise just goes through the standard AWS SDK credential chain, so any valid credential source works.
