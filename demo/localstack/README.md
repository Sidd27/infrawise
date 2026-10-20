# infrawise demo — LocalStack

Runs infrawise against AWS services emulated locally with [LocalStack](https://localstack.cloud) — zero cost, no real AWS account. The seed script creates a range of resources with intentional issues for infrawise to find.

> Uses LocalStack community edition (free). API Gateway v2 (HTTP/WebSocket) and RDS require LocalStack Pro and are not included.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [AWS CLI](https://aws.amazon.com/cli/) installed (`aws --version`)
- infrawise on your PATH (`npm install -g infrawise` or built from source)
- A free LocalStack auth token from [app.localstack.cloud](https://app.localstack.cloud)
- A `localstack` AWS profile in your `~/.aws` (one-time setup below)

---

## One-time: add the `localstack` AWS profile

infrawise talks to whatever endpoint your selected AWS profile points at. To point it at LocalStack, add a `localstack` profile — the only LocalStack-specific setup, and it lives in your AWS config, not in infrawise.

Append to `~/.aws/config`:

```ini
[profile localstack]
region = us-east-1
output = json
endpoint_url = http://localhost:4566
```

Append to `~/.aws/credentials`:

```ini
[localstack]
aws_access_key_id = test
aws_secret_access_key = test
```

LocalStack accepts any credentials. The `endpoint_url` line routes calls to LocalStack; `.env` sets `AWS_PROFILE=localstack` so the SDK resolves this profile.

---

## Run

```bash
cd demo/localstack
cp .env.example .env    # add your LocalStack auth token
./start.sh              # starts LocalStack, seeds resources, runs `infrawise start --claude`
```

After the first run, just open your editor — `.mcp.json` connects automatically.

The resources and their intentional issues are defined in [`seed/aws-seed.sh`](seed/aws-seed.sh).

---

## Stop

```bash
docker compose down
```

---

## Want full service coverage?

The community image has no Cognito, Kinesis, ElastiCache, API Gateway v2, RDS,
MSK, or CloudFront, so this demo leaves parts of infrawise unexercised.
[`demo/floci`](../floci) runs the same seed against [Floci](https://floci.io), an
MIT-licensed emulator that covers all of them — no auth token, no account.

Both listen on port 4566, so stop this one first (`docker compose down`).

## Source-health expectations

The community demo disables Cognito and ElastiCache. API Gateway REST extraction works, but the combined extractor can report `apiGateway` partial because HTTP/WebSocket APIs require a different license. This is a genuine unread portion of the source, not an empty list of APIs. `check` now blocks incomplete reads by default (exit 2 if no blocking findings, or exit 1 when findings already block). Use Floci for broader emulator coverage; do not suppress this distinction in production code. Log groups expose retention metadata only, never message bodies. Background refresh is enabled every 15 minutes after initial snapshot loading.

Verified 2026-10-20: 43 findings, 33 nodes / 9 edges, 4 log groups, and 1 Kinesis stream with this community image. API Gateway is the expected partial source; other enabled sources read successfully. A sentinel event added during privacy testing was absent from tool responses and caches. Counts describe the extracted demo snapshot, not complete runtime coverage.
