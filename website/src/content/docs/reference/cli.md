---
title: CLI reference
description: Complete reference for all Infrawise CLI commands — infrawise start, init, auth, analyze, dev, stdio, doctor, and --version — with all flags and usage examples.
---

Infrawise ships 8 commands. The typical workflow is: `infrawise init` to generate your config file, then `infrawise start --claude` or `infrawise start --cursor` to connect to your editor. Use `infrawise analyze` to re-scan on demand, `infrawise dev` for a persistent HTTP server, and `infrawise doctor` to diagnose connectivity problems.

## `infrawise start`

Analyze infrastructure, write the MCP config file for your editor, then exit. This is the primary command for connecting Infrawise to Claude Code or Cursor.

```bash
infrawise start [options]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `infrawise.yaml` | Path to config file |
| `--claude` | — | Write `.mcp.json` with Claude Code stdio config and open Claude Code |
| `--cursor` | — | Write `.cursor/mcp.json` with Cursor stdio config and open Cursor |
| `--severity <level>` | `medium` | Minimum severity to include: `low`, `medium`, `high` |

Running `infrawise start` without `--claude` or `--cursor` writes `.mcp.json` only (no editor is opened). Re-run any time your infrastructure changes to refresh the graph.

## `infrawise init`

Generate `infrawise.yaml` interactively. Prompts for AWS region, optional profile, and any database connections.

```bash
infrawise init [options]
```

| Flag | Default | Description |
|---|---|---|
| `--force` | — | Overwrite an existing `infrawise.yaml` without prompting |

Run this once per project directory before any other command. The generated file is a starting point — edit it directly to add databases or IaC paths. See the [configuration reference](/infrawise/reference/configuration/) for all available keys.

## `infrawise auth`

Select or switch the active AWS profile. Opens an interactive prompt listing the profiles in `~/.aws/config`.

```bash
infrawise auth
```

The selected profile is stored in `infrawise.yaml` under `services.aws.profile`. You can also set the profile directly in `infrawise.yaml` without running this command.

## `infrawise analyze`

Force a full re-scan and print findings to stdout. Does not start the MCP server. Use this for CI checks, scripted audits, or to inspect findings without opening an editor.

```bash
infrawise analyze [options]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `infrawise.yaml` | Path to config file |
| `--severity <level>` | `low` | Minimum severity to include |
| `--json` | — | Output findings as JSON instead of formatted text |

## `infrawise dev`

Start the MCP server in HTTP transport mode. Keeps running in the foreground. Use this when you prefer HTTP over stdio, need a persistent server shared across multiple tools, or are building a custom MCP client.

```bash
infrawise dev [options]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `infrawise.yaml` | Path to config file |
| `--port <n>` | `3000` | HTTP port |
| `--severity <level>` | `medium` | Minimum severity |

MCP endpoint: `POST http://localhost:<port>/mcp`

## `infrawise stdio`

Start the MCP server in stdio transport mode. This is the transport mode used by editors when they launch Infrawise from `.mcp.json` or `.cursor/mcp.json`. You rarely need to run this directly — your editor manages it.

```bash
infrawise stdio [options]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `infrawise.yaml` | Path to config file |

:::note
`infrawise start --claude` and `infrawise start --cursor` write a config that tells your editor to launch `infrawise stdio` automatically. You only need to run `infrawise stdio` directly when testing stdio transport behavior manually.
:::

## `infrawise doctor`

Validate AWS credential resolution, test connectivity to each configured service, and verify the config file. Prints a pass/fail report for each service and surfaces any permission errors with the specific missing IAM action.

```bash
infrawise doctor
```

Run this first when troubleshooting. No flags required — it reads `infrawise.yaml` from the current directory.

## `infrawise --version`

Print the installed Infrawise version.

```bash
infrawise --version
```

---

## FAQ

### What is the difference between `infrawise start` and `infrawise dev`?

`infrawise start` runs a one-time scan, writes the MCP config file for your editor, then exits. Your editor picks up the config and manages the Infrawise process from there. `infrawise dev` starts a persistent HTTP server at `POST http://localhost:3000/mcp` that stays running until you stop it — useful when you want the server to stay live for direct HTTP calls or when using a non-stdio MCP client.

### When should I run `infrawise analyze` again?

Run `infrawise analyze` (or `infrawise start`) any time you add, remove, or significantly change AWS resources — new Lambda functions, new DynamoDB tables, new SQS queues, etc. The MCP tools your AI calls serve results from the in-memory graph built at startup; they do not re-scan on every call. For always-fresh data during active infrastructure work, use `infrawise dev` and restart it after changes.
