# Changelog

All notable changes to Infrawise will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed

- **Scope-aware variable resolution in AST scanner** — `resolveStringValue` previously did a file-wide search and always returned the first variable declaration with a matching name, causing same-named variables in different functions to resolve to the wrong table. Now uses TypeScript's own symbol resolution (`node.getSymbol()`) which is scope-aware.

### Added

- **SNS filter policies in `get_topic_details`** — the tool now returns filter policies for each subscription, including the required message attribute keys (`requiredAttributes`) and scope. Publishers must include these attributes or messages are silently dropped by the subscription with no error.

---

## [0.1.0] — 2026-05-07

### Added

- **CLI** — `infrawise init`, `auth`, `analyze`, `dev`, `doctor` commands
- **DynamoDB adapter** — introspects tables, partition keys, sort keys, GSIs via AWS SDK v3
- **PostgreSQL adapter** — introspects schemas, columns, indexes via `pg`
- **MySQL adapter** — introspects `information_schema` via `mysql2`
- **MongoDB adapter** — lists collections and indexes via `mongodb` driver
- **Terraform/CloudFormation adapter** — parses `.tf` files (regex HCL) and CFN YAML/JSON to extract DynamoDB tables, RDS instances, DocumentDB clusters
- **Graph engine** — builds a normalized infrastructure graph (nodes: table, function, index, query; edges: query, scan, joins, uses_index)
- **Repository scanner** — AST-based analysis via `ts-morph`; detects DynamoDB, PostgreSQL, MySQL, MongoDB usage patterns
- **Analyzer engine** — 11 rule-based deterministic analyzers:
  - DynamoDB: `FullTableScanAnalyzer` (high), `MissingGSIAnalyzer` (medium), `HotPartitionAnalyzer` (medium)
  - PostgreSQL: `MissingIndexAnalyzer` (medium/high), `NplusOneAnalyzer` (medium), `LargeSelectAnalyzer` (low)
  - MySQL: `MySQLFullTableScanAnalyzer` (high), `MissingMySQLIndexAnalyzer` (medium)
  - MongoDB: `MongoCollectionScanAnalyzer` (high), `MissingMongoIndexAnalyzer` (medium)
  - IaC: `IaCDriftAnalyzer` (medium) — detects deployed-not-in-IaC and defined-not-deployed drift
- **MCP server** — Fastify HTTP server at `localhost:3000/mcp` with 6 tools: `get_graph_summary`, `analyze_function`, `suggest_gsi`, `postgres_index_suggestions`, `suggest_mongo_index`, `mysql_index_suggestions`
- **Claude Code integration** — MCP server wires directly into Claude Code for live infrastructure context
- **Colorful CLI output** — `chalk`, `ora` spinners, `inquirer` interactive prompts, severity badges, summary box
- **Local cache** — analysis results cached in `.infrawise/cache/` for fast subsequent runs
- **GitHub Actions CI** — lint, typecheck, test, build workflows
- **Release pipeline** — tag → draft release → publish release → auto npm publish via trusted publishing

[0.1.0]: https://github.com/Sidd27/infrawise/releases/tag/v0.1.0
