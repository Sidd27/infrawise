# infrawise demo — Floci

Runs infrawise against every AWS service it supports, emulated locally with
[Floci](https://floci.io) — an MIT-licensed AWS emulator on port 4566. No AWS
account, no auth token, no feature gates.

> This is the most complete demo. The LocalStack demo runs on the community
> image, which has no Cognito, Kinesis, ElastiCache, API Gateway v2, RDS, MSK, or
> CloudFront. Floci emulates all of them, so every infrawise adapter and analyzer
> is exercised in one run.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [AWS CLI](https://aws.amazon.com/cli/) installed (`aws --version`)
- infrawise on your PATH (`npm install -g infrawise` or built from source)
- A `floci` AWS profile in your `~/.aws` (one-time setup below)

No auth token. No sign-up.

---

## One-time: add the `floci` AWS profile

infrawise talks to whatever endpoint your selected AWS profile points at. To
point it at Floci, add a `floci` profile — the only emulator-specific setup, and
it lives in your AWS config, not in infrawise.

Append to `~/.aws/config`:

```ini
[profile floci]
region = us-east-1
output = json
endpoint_url = http://localhost:4566
```

Append to `~/.aws/credentials`:

```ini
[floci]
aws_access_key_id = test
aws_secret_access_key = test
```

Floci accepts any non-empty credentials. The `endpoint_url` line routes calls to
Floci; `.env` sets `AWS_PROFILE=floci` so the SDK resolves this profile.

Since Floci and LocalStack both listen on 4566, only run one at a time.

---

## Run

```bash
cd demo/floci
cp .env.example .env
./start.sh              # starts Floci, seeds resources, runs `infrawise start --claude`
```

After the first run, just open your editor — `.mcp.json` connects automatically.

---

## Stop

```bash
docker compose down
```

---

## What gets seeded

[`seed/aws-seed.sh`](seed/aws-seed.sh) runs the LocalStack demo's seed script
unchanged — Floci is a drop-in on the same port, so nothing about the shared
resources needs to differ — then adds the services LocalStack community cannot
emulate.

| Source | Resources |
| --- | --- |
| Shared seed | DynamoDB (Orders, Users, LegacyOrders), SQS (6 queues incl. FIFO + DLQ + visibility mismatch), SNS (2 topics, filter policy), SSM, Secrets Manager, Lambda (3), S3 (3 buckets), EventBridge (2 rules), API Gateway REST, CloudWatch Logs, Kinesis, Cognito, ElastiCache |
| Floci only | API Gateway v2 HTTP API, CloudFront distribution, RDS instance, MSK cluster |
| Local files | `terraform/` (IaC drift), `cdk.out/` (per-stack staleness) |

### Cases worth looking at

**Route-to-Lambda attribution.** The HTTP API's integrations use a bare function
ARN (`arn:...:function:processOrders`) and an aliased ARN
(`...:function:generateReport:live`) — the two forms CDK's
`HttpLambdaIntegration` produces. `get_api_routes` must name `processOrders` and
`generateReport` for those, and `null` for `GET /v2/health`, which has no
integration.

**CloudFront path routing.** One distribution fronts two backends: `/api/*` goes
to the HTTP API, everything else to `assets-bucket`. `get_cloudfront_overview`
resolves the `execute-api` origin back to `orders-http-api` by name, so you can
answer "which behavior serves this path and what does it hit" without opening the
console. The `/api/*` behavior is deliberately `allow-all`, which raises a
medium-severity finding.

**Per-stack CDK staleness.** `cdk.out/` is checked in with a `manifest.json`
listing only `PaymentsStack`. `LegacyBillingStack.template.json` has no manifest
entry, so its resources are excluded from the graph and drift analysis, and its
output comes back from `get_stack_outputs` with `stale: true`. See
[`cdk.out/README.md`](cdk.out/README.md).

**RDS.** `demo-postgres` is public, unencrypted, has no backups, no deletion
protection, and is single-AZ — all five RDS analyzers fire on one instance.

---

## Known fidelity gaps

Checked against floci 1.5.x. None of these affect real AWS.

- `DescribeCacheClusters` does not list Redis replication-group members, so the
  seed uses memcached for portability.
- API Gateway REST `GetResources` does not return embedded methods, so the REST
  API extracts with 0 routes. The v2 HTTP API is unaffected and is where route
  attribution is exercised.
- The CloudFront distribution uses legacy `ForwardedValues` rather than a
  `CachePolicyId`, so behaviors report no cache policy name. Against real AWS a
  cache policy id resolves to its name (for example `CachingDisabled`).
- MSK is best effort: Floci backs it with a real Redpanda container, which is the
  heaviest thing in the seed. If it does not come up, everything else still does.
