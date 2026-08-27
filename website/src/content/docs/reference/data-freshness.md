---
title: Data freshness
description: Reference for the dataHealth block on every Infrawise MCP response — every field, the three clocks that govern staleness, and the freshness config key.
---

Infrawise answers from a snapshot. `infrawise analyze` reads your cloud account, databases, and IaC files once and caches the result; every MCP tool answers from that cache, and no tool call re-reads AWS. This page is the field reference for how that snapshot's age is reported.

For how to think about it — where age misleads, and what to do about it — see [How Infrawise handles staleness](/infrawise/guides/how-infrawise-handles-staleness/).

## The `dataHealth` block

Every tool response carries a `dataHealth` object with a fixed shape. Every key is always present; state lives in values, never in whether a key exists. `error` and `reason` are `null` rather than omitted, so nothing has to be inferred from absence.

| Field                    | Meaning                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyzedAt`             | ISO timestamp of when the infrastructure was **read**. `null` when no analysis is loaded                                                             |
| `ageSeconds`             | How long ago that was. `null` when no analysis is loaded                                                                                             |
| `suggestRefresh`         | `true` past the configured threshold (6h by default). Also `true` when no analysis is loaded — never a claim of freshness that cannot be vouched for |
| `refreshWith`            | The command that refreshes: `infrawise analyze`. Always present; states how, never whether                                                           |
| `requestedMaxAgeSeconds` | Echoes the `maxAgeSeconds` you passed. `null` when you passed none                                                                                   |
| `withinRequestedAge`     | Whether the data meets it. `null` when no tolerance was requested                                                                                    |
| `region` / `profile`     | Which account context produced the snapshot. `null` when unknown                                                                                     |
| `sources`                | One entry per source the answer rests on: `service`, `status` (`ok`/`failed`/`partial`/`disabled`), `error`                                          |
| `iac`                    | Whether `cdk.out` has been synthed since the analysis: `status` (`changed`/`unchanged`/`unknown`), `synthedAt`, `analyzedAt`, `reason`               |

`ageSeconds` is the fact; `suggestRefresh` is one coarse verdict offered on top of it.

`get_infra_overview` lists every source in `dataHealth.sources` rather than one tool's. `get_graph_summary` additionally marks each node with `source` and `sourceStatus`.

## Reading `sources` and `iac`

A source whose `status` is not `ok` means an empty result is **"not read"**, not "none exist". Do not conclude from such a response that a queue has no DLQ, that a secret has no rotation, or that a table does not exist. `get_table_schema` is the sharpest case: with a database listed as `failed` or `disabled`, `found: false` means "not looked for".

An `iac.status` of `changed` means `cdk synth` ran after the analysis, so IaC-derived answers are behind. `unknown` means the check could not run, and says nothing either way.

## The three clocks

| Clock           | Default | Configurable | What it governs                                                                                      |
| --------------- | ------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| Cache TTL       | 24h     | no           | Whether a cached analysis is loaded at boot. Past it, `serve` / `start` run a fresh analysis instead |
| Refresh hint    | 6h      | yes          | The value of `suggestRefresh` on every response. Changes nothing about the data returned             |
| `maxAgeSeconds` | none    | per call     | A caller-supplied tolerance. Sets `requestedMaxAgeSeconds` and `withinRequestedAge`                  |

`maxAgeSeconds` is **advisory**: exceeding it does not withhold data or fail the call. The result still comes back, marked. No tool call re-reads AWS — refreshing is `infrawise analyze`.

## The cache entries and their clock

`infrawise analyze` writes five entries into `.infrawise/cache/`, resolved next to your `infrawise.yaml`:

| Entry        | Contents                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `graph`      | Nodes and edges                                                                                                     |
| `findings`   | Analyzer output                                                                                                     |
| `operations` | Infrastructure calls extracted from your code                                                                       |
| `meta`       | Cloud and database metadata: DynamoDB key schemas and indexes, Postgres/MySQL/Mongo schemas, per-service attributes |
| `provenance` | `analyzedAt`, `region`, `profile`, per-source status, `cdkOutDir`                                                   |

Each entry carries the timestamp it was written at, and that timestamp governs **expiry only**. It is never reported as freshness. `analyzedAt` lives inside `provenance` and is the only value `dataHealth` dates an answer from.

The five entries describe one analysis and expire as one. That invariant is load-bearing: `graph` outliving `meta` produces a graph with no cloud facts in it, and `graph` outliving `provenance` produces answers Infrawise cannot date, which report `analyzedAt: null` and `suggestRefresh: true` regardless of how recent the read actually was.

## What a file save does

While `infrawise serve`, `infrawise stdio`, or an editor-launched server is running, it watches your source tree. Saving a `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, or `.cjs` file outside `node_modules` triggers a **code refresh**, debounced by 2 seconds:

1. Re-scan the repository for infrastructure calls
2. Re-parse local IaC files (Terraform, CDK, CloudFormation)
3. Rebuild the graph, taking every cloud and database fact from the cached `meta`
4. Re-run the analyzers

**No AWS call and no database query happens.** Exactly what this means for each clock:

|                                | Effect of a code refresh                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyzedAt`                   | Unchanged. The cloud facts in the rebuilt graph are exactly as old as they were before                                                                  |
| `ageSeconds`                   | Keeps counting from the last real read, not from the rebuild                                                                                            |
| `suggestRefresh`               | Unchanged by the rebuild; still flips on the 6h threshold measured from `analyzedAt`                                                                    |
| `sources`, `region`, `profile` | Unchanged — they come from `provenance`, which a code refresh does not re-derive                                                                        |
| Cache entries                  | `graph`, `findings` and `operations` are rewritten; `meta` and `provenance` are re-stamped with their contents untouched, so all five stay on one clock |

That last row is the part worth stating plainly. A code refresh rewrites three of the five entries, which resets their expiry. Re-stamping the other two keeps the whole set expiring together. Without it, a session where you keep editing code holds `graph` alive indefinitely while `meta` and `provenance` quietly hit the 24h TTL underneath it — after which the graph loses every cloud fact and `dataHealth` reports `analyzedAt: null` and `suggestRefresh: true` on every call for the rest of the session, while still answering from that graph.

Editing code is not a refresh. `infrawise analyze` is the only thing that moves `analyzedAt`.

## Reloading a running server

`infrawise analyze` writes its result to the cache, and a running MCP server rechecks that cache on every tool call — one stat of a local file, cheaper than the response it guards. A new analysis is therefore visible to the next call, with no restart and no editor reconnect. Running `analyze` in a second terminal while your editor session stays open is the intended refresh loop.

## Configuration

```yaml
freshness:
  suggestRefreshAfterHours: 6 # default
```

Applies to `infrawise serve`, `infrawise stdio`, and editor-launched MCP servers. Accepts fractional values (`0.5` for 30 minutes). The 24h cache TTL is fixed and unaffected.
