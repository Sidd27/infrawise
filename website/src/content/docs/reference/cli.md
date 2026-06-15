---
title: CLI reference
description: Complete reference for all Infrawise CLI commands — infrawise start, analyze, check, serve, doctor, and --version — with all flags and usage examples.
---

Infrawise ships five commands, one per job: `infrawise start` to onboard (probe, generate config, analyze, connect your editor), `infrawise analyze` for an on-demand report, `infrawise check` as a CI/CD gate, `infrawise serve` to run the MCP server directly, and `infrawise doctor` to diagnose connectivity problems.

## `infrawise start`

Probe the environment, generate `infrawise.yaml` if missing, analyze, write the MCP config file for your editor, then exit. This is the primary command — no config file is required on the first run.

```bash
infrawise start [options]
```

| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | `infrawise.yaml` | Path to config file |
| `--claude` | — | Write `.mcp.json` and open Claude Code |
| `--cursor` | — | Write `.cursor/mcp.json` and open Cursor |
| `--interactive` | — | Run the guided setup wizard instead of auto-discovery |
| `--rediscover` | — | Delete `infrawise.yaml` and the `.infrawise/` directory, then re-probe and re-analyze from scratch |

Running `infrawise start` without `--claude` or `--cursor` writes `.mcp.json` only (no editor is opened). Re-run any time your infrastructure changes to refresh the graph, or use `--rediscover` for a clean slate.

## `infrawise analyze`

Force a full re-scan and print findings to stdout. Does not start the MCP server. Use this for scripted audits or to inspect findings without opening an editor.

```bash
infrawise analyze [options]
```

| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | `infrawise.yaml` | Path to config file |
| `-r, --repo <path>` | current dir | Repository to scan for service usage |
| `--no-cache` | — | Skip reading/writing the cache |
| `-o, --output <path>` | — | Save findings as a markdown report, e.g. `report.md` |
| `--severity <level>` | — | Only show findings at or above: `high`, `medium`, `low` |

## `infrawise check`

CI/CD gate. Runs a fresh analysis and exits with a non-zero code when findings reach the threshold severity, so it can block a deploy without an AI editor in the loop.

```bash
infrawise check [options]
```

| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | `infrawise.yaml` | Path to config file |
| `-r, --repo <path>` | current dir | Repository to scan for service usage |
| `--fail-on <level>` | `high` | Severity that fails the build: `high`, `medium`, `low` |

```bash
# Block a deploy if any high-severity finding exists (exit 1)
infrawise check

# Stricter gate — fail on medium and above
infrawise check --fail-on medium
```

## `infrawise serve`

Start the MCP server directly. Defaults to HTTP transport; pass `--stdio` for the transport editors use. Keeps running in the foreground.

```bash
infrawise serve [options]
```

| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | `infrawise.yaml` | Path to config file |
| `--stdio` | — | Use stdio transport (for editors via `.mcp.json`) instead of HTTP |
| `-p, --port <n>` | `3000` | HTTP port (HTTP only) |

MCP endpoint (HTTP): `POST http://localhost:<port>/mcp`

:::note
`infrawise start --claude` and `infrawise start --cursor` write a `.mcp.json` that launches `infrawise serve --stdio` automatically. You rarely need to run `serve` directly. (Configs generated before this rename invoke a hidden `infrawise stdio` alias, which still works.)
:::

## `infrawise doctor`

Diagnostic escape hatch. Validates AWS credential resolution, tests connectivity to each configured service, and verifies the config file. Prints a pass/fail report per service and surfaces permission errors with the specific missing IAM action.

```bash
infrawise doctor
```

Run this when extraction comes up empty. No flags required beyond `--config` — it reads `infrawise.yaml` from the current directory.

## `infrawise --version`

Print the installed Infrawise version.

```bash
infrawise --version
```

---

## FAQ

### What is the difference between `infrawise start` and `infrawise serve`?

`infrawise start` runs a one-time scan, writes the MCP config file for your editor, then exits. Your editor picks up the config and manages the Infrawise process from there. `infrawise serve` starts the MCP server in the foreground — HTTP by default, or `--stdio` — and stays running until you stop it. Use `serve` for direct HTTP calls or non-stdio MCP clients.

### How do I gate CI/CD on findings?

Use `infrawise check`. It runs a fresh analysis and exits `1` when any finding reaches `--fail-on` severity (default `high`), so it fails the pipeline step. Example: `infrawise check --fail-on high`.

### When should I run `infrawise analyze` again?

Run `infrawise analyze` (or `infrawise start`) any time you add, remove, or significantly change AWS resources — new Lambda functions, new DynamoDB tables, new SQS queues, etc. The MCP tools your AI calls serve results from the in-memory graph built at startup; they do not re-scan on every call. For always-fresh data during active infrastructure work, use `infrawise serve` and restart it after changes.
