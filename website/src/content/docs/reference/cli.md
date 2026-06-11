---
title: CLI reference
description: All Infrawise CLI commands and flags.
---

## `infrawise start`

Analyze infrastructure and write `.mcp.json` for stdio-based editors.

```bash
infrawise start [options]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `infrawise.yaml` | Path to config file |
| `--claude` | — | Write `.mcp.json` with Claude Code stdio config |
| `--severity <level>` | `medium` | Minimum severity: `low`, `medium`, `high` |

## `infrawise dev`

Start the MCP server in HTTP transport mode. Keeps running in the foreground.

```bash
infrawise dev [options]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `infrawise.yaml` | Path to config file |
| `--port <n>` | `3000` | HTTP port |
| `--severity <level>` | `medium` | Minimum severity |

MCP endpoint: `POST http://localhost:<port>/mcp`

## `infrawise analyze`

Run analysis and print findings to stdout without starting the MCP server.

```bash
infrawise analyze [options]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `infrawise.yaml` | Path to config file |
| `--severity <level>` | `low` | Minimum severity to include |
| `--json` | — | Output as JSON |

## `infrawise --version`

Print the installed version.
