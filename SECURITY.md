# Security Policy

## Supported versions

Only the latest published release of infrawise receives security fixes.

| Version | Supported |
|---|---|
| Latest 0.x release | Yes |
| Anything older | No |

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/Sidd27/infrawise/security/advisories/new). Do not open a public issue for security reports.

You will get an initial response within 72 hours. Confirmed vulnerabilities are fixed in the next release, and the advisory is published once the fix is available.

## Scope

infrawise runs entirely on the user's machine. Relevant to security review:

- All AWS calls are read-only (Describe/List/Get). infrawise never writes to AWS or executes DDL.
- Secret values, SSM parameter values, Cognito user data, cached data, and raw log messages are never read.
- No telemetry; nothing leaves the machine.
- Database connection strings can be kept out of `infrawise.yaml` via `${ENV_VAR}` expansion or `.infrawise/secrets.yaml`.

Reports that break any of those guarantees are the highest-priority class of issue.
