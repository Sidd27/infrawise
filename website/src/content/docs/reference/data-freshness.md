---
title: Data freshness
description: Reference for the dataHealth block on every Infrawise MCP response — every field, the three clocks that govern staleness, and the freshness config key.
---

Infrawise answers from a snapshot. `infrawise analyze` reads your cloud account, databases, and IaC files once and caches the result; every MCP tool answers from that cache, and no tool call re-reads AWS. This page is the field reference for how that snapshot's age is reported.

For how to think about it — where age misleads, and what to do about it — see [How Infrawise handles staleness](/infrawise/guides/how-infrawise-handles-staleness/).

## The `dataHealth` block

Every tool response carries a `dataHealth` object with a fixed shape. Every key is always present; state lives in values, never in whether a key exists. `error` and `reason` are `null` rather than omitted, so nothing has to be inferred from absence.

| Field | Meaning |
|---|---|
| `analyzedAt` | ISO timestamp of when the infrastructure was **read**. `null` when no analysis is loaded |
| `ageSeconds` | How long ago that was. `null` when no analysis is loaded |
| `suggestRefresh` | `true` past the configured threshold (6h by default). Also `true` when no analysis is loaded — never a claim of freshness that cannot be vouched for |
| `refreshWith` | The command that refreshes: `infrawise analyze`. Always present; states how, never whether |
| `requestedMaxAgeSeconds` | Echoes the `maxAgeSeconds` you passed. `null` when you passed none |
| `withinRequestedAge` | Whether the data meets it. `null` when no tolerance was requested |
| `region` / `profile` | Which account context produced the snapshot. `null` when unknown |
| `sources` | One entry per source the answer rests on: `service`, `status` (`ok`/`failed`/`partial`/`disabled`), `error` |
| `iac` | Whether `cdk.out` has been synthed since the analysis: `status` (`changed`/`unchanged`/`unknown`), `synthedAt`, `analyzedAt`, `reason` |

`ageSeconds` is the fact; `suggestRefresh` is one coarse verdict offered on top of it.

`get_infra_overview` lists every source in `dataHealth.sources` rather than one tool's. `get_graph_summary` additionally marks each node with `source` and `sourceStatus`.

## Reading `sources` and `iac`

A source whose `status` is not `ok` means an empty result is **"not read"**, not "none exist". Do not conclude from such a response that a queue has no DLQ, that a secret has no rotation, or that a table does not exist. `get_table_schema` is the sharpest case: with a database listed as `failed` or `disabled`, `found: false` means "not looked for".

An `iac.status` of `changed` means `cdk synth` ran after the analysis, so IaC-derived answers are behind. `unknown` means the check could not run, and says nothing either way.

## The three clocks

| Clock | Default | Configurable | What it governs |
|---|---|---|---|
| Cache TTL | 24h | no | Whether a cached analysis is loaded at boot. Past it, `serve` / `start` run a fresh analysis instead |
| Refresh hint | 6h | yes | The value of `suggestRefresh` on every response. Changes nothing about the data returned |
| `maxAgeSeconds` | none | per call | A caller-supplied tolerance. Sets `requestedMaxAgeSeconds` and `withinRequestedAge` |

`maxAgeSeconds` is **advisory**: exceeding it does not withhold data or fail the call. The result still comes back, marked. Nothing re-reads AWS on a tool call — refreshing is `infrawise analyze`.

## Configuration

```yaml
freshness:
  suggestRefreshAfterHours: 6 # default
```

Applies to `infrawise serve`, `infrawise stdio`, and editor-launched MCP servers. Accepts fractional values (`0.5` for 30 minutes). The 24h cache TTL is fixed and unaffected.
