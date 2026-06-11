---
title: Configuration reference
description: Complete reference for infrawise.yaml configuration keys.
---

Infrawise reads `infrawise.yaml` from the current directory by default. Override with `--config path/to/file.yaml`.

## Full schema

```yaml
services:
  aws:
    region: us-east-1          # required
    profile: my-profile        # optional — uses default credential chain if omitted
    endpoint: http://localhost:4566  # optional — override for LocalStack

  databases:
    postgres:
      - host: localhost
        port: 5432
        database: myapp
        user: postgres
        password: secret        # supports ${ENV_VAR} substitution

    mysql:
      - host: localhost
        port: 3306
        database: myapp
        user: root
        password: secret

    mongodb:
      - uri: mongodb://localhost:27017/myapp

  iac:
    terraform:
      - path: ./infrastructure  # directory containing .tf files
    cloudformation:
      - path: ./cloudformation  # directory containing .yaml/.json templates
    cdk:
      - path: ./cdk/lib         # directory containing CDK stack files

analysis:
  severity: medium              # minimum severity to report: low | medium | high
```

## Environment variable substitution

Any value can reference an environment variable with `${VAR_NAME}`:

```yaml
password: ${DB_PASSWORD}
```

Infrawise resolves these at startup. Unresolved variables cause a startup error.
