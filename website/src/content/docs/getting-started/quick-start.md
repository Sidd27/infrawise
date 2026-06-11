---
title: Quick start
description: Get Infrawise running against your AWS environment in under 60 seconds.
---

## 1. Configure your AWS credentials

Infrawise uses your existing AWS credentials — the same ones the AWS CLI uses.

```bash
aws configure
# or set environment variables:
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1
```

## 2. Create `infrawise.yaml`

```yaml
services:
  aws:
    region: us-east-1
    # profile: my-profile   # optional, uses default if omitted
  databases:
    postgres:
      - host: localhost
        port: 5432
        database: myapp
        user: postgres
        password: ${POSTGRES_PASSWORD}
```

## 3. Run

```bash
infrawise start --claude
```

Infrawise scans your infrastructure, runs 23 analyzers, and writes `.mcp.json`.
Open Claude Code in the same directory — the 15 MCP tools are immediately available.

## 4. Ask your AI

```
What infrastructure issues should I fix first?
```

Claude Code calls `get_infra_overview` and returns a prioritized list of findings.
