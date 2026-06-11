---
title: LocalStack demo
description: Run Infrawise against emulated AWS services — no AWS account needed.
---

The LocalStack demo validates the full adapter stack against real AWS service emulations. Requires Docker Desktop and a free LocalStack account.

## Prerequisites

- Docker Desktop running
- AWS CLI installed
- Free LocalStack auth token from [app.localstack.cloud](https://app.localstack.cloud)

## Start

```bash
cd demo/localstack
cp .env.example .env        # paste your LocalStack auth token
./start.sh                  # starts LocalStack + seeds all resources
```

In a new terminal:

```bash
source .env
infrawise analyze --config infrawise.yaml
```

Expected: **23+ findings** across DynamoDB, SQS, Lambda, Secrets Manager, CloudWatch Logs, S3.

## Start the MCP server against LocalStack

```bash
infrawise dev --config infrawise.yaml
```

## Stop

```bash
docker compose down
```
