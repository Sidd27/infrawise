---
title: Installation
description: Install Infrawise — the open-source MCP server that maps AWS infrastructure for AI coding assistants — and connect it to Claude Code or Cursor in under two minutes.
---

Infrawise is an open-source MCP (Model Context Protocol) server that gives AI coding assistants like Claude Code and Cursor a real-time, read-only map of your AWS infrastructure. It runs 34 rule-based analyzers and exposes 20 MCP tools your AI can call while you write code — without leaving your editor. This page covers installation, connecting to your editor, and the AWS credentials Infrawise needs.

## Prerequisites

- **Node.js 20 or later** — check with `node --version`
- **AWS credentials configured** — the same credentials the AWS CLI uses; see [AWS setup](/infrawise/getting-started/aws-setup/) for the minimum IAM policy
- **Claude Code or Cursor** — Infrawise writes the MCP config file your editor reads automatically

## Install

```bash
npm install -g infrawise
```

Verify the installation:

```bash
infrawise --version
```

## Connect to Claude Code

```bash
infrawise start --claude
```

Infrawise scans your AWS infrastructure, runs the 34 analyzers, and writes `.mcp.json` to the current directory. Claude Code reads `.mcp.json` automatically on next launch — no plugin, no extension, no manual config editing required. All 20 MCP tools are immediately available.

## Connect to Cursor

```bash
infrawise start --cursor
```

Writes `.cursor/mcp.json` and opens Cursor. All 20 Infrawise MCP tools appear in Cursor's MCP panel.

## HTTP transport mode

If you prefer HTTP over stdio, or need multiple tools to share one running server instance:

```bash
infrawise serve --config infrawise.yaml
```

The server starts at `POST http://localhost:3000/mcp` and stays running in the foreground. Useful for debugging tool calls or integrating with custom MCP clients.

## AWS credentials

Infrawise reads your existing AWS credentials — the same credential chain the AWS CLI uses:

```bash
# Option 1: interactive setup stored in ~/.aws/credentials
aws configure

# Option 2: environment variables
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1
```

Infrawise needs read-only access to the AWS services you configure. See [AWS setup](/infrawise/getting-started/aws-setup/) for the exact minimum IAM policy and how to scope it to specific resources.

:::note
No AWS account yet? The [LocalStack demo](/infrawise/guides/localstack-demo/) lets you run Infrawise against emulated AWS services locally using Docker — no real AWS account or credentials required.
:::

---

## FAQ

### Does Infrawise work without an AWS account?

Yes. The [LocalStack demo](/infrawise/guides/localstack-demo/) runs Infrawise against locally emulated AWS services using Docker. You need a free LocalStack account (no credit card) but no real AWS account.

### Does Infrawise store my infrastructure data?

No. Infrawise runs entirely on your local machine. Infrastructure data is held in memory during the session and is never sent to any external server. There is no telemetry and no cloud sync.

### Can I use Infrawise with VS Code?

Not directly. Infrawise targets editors with native MCP support: Claude Code and Cursor. For HTTP transport use cases, `infrawise serve` starts a server at `POST http://localhost:3000/mcp` that any MCP-compatible client can connect to.

### What happens when I run `infrawise start`?

`infrawise start` does the following in sequence: auto-generates `infrawise.yaml` in the current directory if one doesn't exist (by probing your environment), scans the configured AWS services and databases using read-only API calls, runs the 34 analyzers to generate findings, writes the MCP config file for your editor (`.mcp.json` for Claude Code, `.cursor/mcp.json` for Cursor), then exits. The scan typically completes in a few seconds depending on the number of resources in your account.

### Why do some security scanners flag Infrawise?

Some supply-chain security scanners flag this package under "deceptive naming" because of the prefix "infra." This is a false positive from automated tooling. Infrawise is completely safe, open-source, and unaffiliated with any commercial trademarks. You can verify by reading the [source on GitHub](https://github.com/Sidd27/infrawise).
