---
title: AWS setup
description: IAM permissions required for Infrawise to read your AWS infrastructure.
---

Infrawise only reads AWS resources — it never writes, executes, or modifies anything.

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

## Using a named profile

```yaml
services:
  aws:
    region: us-east-1
    profile: infrawise-readonly
```

## LocalStack (no AWS account needed)

See the [LocalStack demo guide](/infrawise/guides/localstack-demo/) to run Infrawise against emulated AWS services locally.
