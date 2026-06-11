---
title: Installation
description: Get infrawise installed and wired into your AI editor in under two minutes.
---

Node.js 18+, AWS credentials configured, and one command.

## Install

```bash
npm install -g infrawise
```

Verify it's there:

```bash
infrawise --version
```

## Wire it up — Claude Code

```bash
infrawise start --claude
```

Scans your infrastructure, writes `.mcp.json` to the current directory. Claude Code reads it automatically on next launch — no plugin, no extension, no config file to hand-edit.

## Wire it up — Cursor or Windsurf

```bash
infrawise start
```

Then point your editor at the MCP server. Check [MCP tools](/infrawise/reference/mcp-tools/) for what gets exposed.

## HTTP transport

Prefer HTTP over stdio? Run the server in the foreground:

```bash
infrawise dev --config infrawise.yaml
```

Server starts at `POST http://localhost:3000/mcp` and stays running. Useful for debugging or when multiple tools need to share one server instance.

## AWS credentials

Infrawise reads your existing AWS credentials — same as the CLI:

```bash
# Option 1: ~/.aws/credentials (default)
aws configure

# Option 2: environment variables
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1
```

No extra IAM setup. It needs read-only access to whatever services you've configured — see [AWS setup](/infrawise/getting-started/aws-setup/) for the minimal policy.
