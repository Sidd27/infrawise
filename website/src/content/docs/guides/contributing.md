---
title: Contributing
description: How to contribute to Infrawise.
---

## Development setup

```bash
git clone https://github.com/Sidd27/infrawise.git
cd infrawise
pnpm install
pnpm build
pnpm test
```

## Before submitting a PR

```bash
pnpm lint && pnpm typecheck && pnpm test
```

All three must pass.

## Adding a new adapter

1. Add the extractor under `src/adapters/`
2. Add the matching analyzer under `src/analyzers/`
3. Add a representative example to `demo/local/app/` and `demo/local/infrawise.yaml`
4. Update `README.md`, `AGENTS.md`, and `llms.txt` — see `AGENTS.md` for the doc sync rules

## Reporting issues

[github.com/Sidd27/infrawise/issues](https://github.com/Sidd27/infrawise/issues)
