---
title: Configuration reference
description: Complete reference for infrawise.yaml — the config file that tells Infrawise which AWS region, databases, and IaC sources to scan. Includes all keys, defaults, and environment variable substitution.
---

`infrawise.yaml` is the single config file that tells Infrawise what to scan: which AWS region and profile to use, which databases to connect to, where your IaC files live, and what severity threshold to apply. Infrawise reads this file at startup every time a command runs.

`infrawise start` generates this file automatically on its first run by probing your environment. To answer the questions yourself instead of auto-discovery, pass `--interactive`. Or create it manually using the schema below.

## Minimal configuration (AWS only)

If you only need AWS analysis and no database or IaC scanning, this is all you need:

```yaml
services:
  aws:
    region: us-east-1
```

Infrawise uses the default AWS credential chain (environment variables, `~/.aws/credentials`, instance profile) when no `profile` key is set.

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

## Key explanations

**`services.aws`** controls which AWS account and region Infrawise scans. `region` is required. `profile` selects a named profile from `~/.aws/config`; omit it to use the default credential chain. `endpoint` overrides the AWS service endpoint URL — set this to `http://localhost:4566` when using LocalStack.

**`services.databases`** lists the databases Infrawise should connect to for schema analysis. Infrawise reads table/collection names, column definitions, and index configurations — it never queries row data. Each database type accepts an array, so you can list multiple instances. Passwords support `${ENV_VAR}` substitution (see below).

**`services.iac`** points Infrawise at your IaC source directories. Infrawise parses these files locally to detect drift between your IaC definitions and live AWS state. Paths are relative to the location of `infrawise.yaml`.

**`analysis.severity`** sets the minimum finding severity included in results: `low` includes everything, `medium` excludes low-severity findings, `high` shows only high-severity findings. This default is overridden per-command by the `--severity` flag.

## Environment variable substitution

Any value in `infrawise.yaml` can reference an environment variable using `${VAR_NAME}` syntax:

```yaml
password: ${DB_PASSWORD}
uri: mongodb://${MONGO_USER}:${MONGO_PASS}@localhost:27017/myapp
```

Infrawise resolves environment variables at startup. If a referenced variable is not set, Infrawise exits with an error identifying the unresolved key — it will not start with a partially configured database connection.

:::tip
Never commit database passwords or AWS credentials to `infrawise.yaml`. Use `${ENV_VAR}` substitution and store real values in a `.env` file that is listed in `.gitignore`.
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

### What happens if a database is unreachable during startup?

Infrawise logs a warning for the unreachable database and continues. AWS analysis and IaC analysis proceed normally. The database-specific MCP tools (index suggestions, schema info) return empty results for the unreachable instance. Run `infrawise doctor` to diagnose connectivity issues before starting a session.
