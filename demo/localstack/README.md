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
