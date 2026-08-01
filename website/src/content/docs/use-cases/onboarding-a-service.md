---
title: Onboarding onto a service you did not build
description: Infrawise gives a new engineer the blast radius of an unfamiliar service — every table, queue, topic, and route-to-Lambda binding — without reading the IaC or clicking through the console.
---

The first week on an unfamiliar service is spent reconstructing a picture that already exists: which tables it reads, which queues it consumes, which Lambda answers which route. That picture normally lives in Terraform files, console tabs, and other people's memory. Infrawise builds it from the live account and serves it to your assistant, so the question "what does checkout actually touch?" gets a complete answer instead of a partial one.

## What you get

**The whole surface, counted.** `get_infra_overview` returns tables, functions, queues, topics, secrets, Lambdas, and buckets with high-severity findings attached — enough to know the shape of the service before you open a file.

**The edges, not just the nodes.** `get_graph_summary` returns every relationship: which function queries which table, which queue triggers which Lambda, which function publishes to which topic. This is the blast radius you need before your first change.

**The route map.** `get_api_routes` returns every API with its method, path, and the Lambda behind it — including routes with no Lambda integration, which are usually either dead or half-wired.

## How to use it

**Start every session with the overview:**

```
get_infra_overview()
```

Also returns a `freshness` object — `analyzedAt`, `ageSeconds`, and a `stale` flag once the analysis passes 24 hours — so you know whether you are looking at today's account or last week's.

**Then trace the specific thing you were asked to change:**

```
analyze_function({ function: "processCheckout" })
```

Returns the file path, every service and table the function accesses with the edge type, the triggers with their correct handler event shape, and `missingPermissions` — services the code calls that the execution role does not allow.

**Before writing a query, pull only the schemas you need:**

```
get_table_schema({ tables: ["orders", "customers"] })
```

Returns columns, types, primary keys, and foreign keys — the join paths — for just those tables. On a database with hundreds of tables this is the difference between a usable context window and a full schema dump.

## Why this matters

A new engineer's first pull request is the one most likely to miss a constraint nobody wrote down: the queue that is FIFO, the table without a GSI for the access pattern they need, the route already bound to a different function. None of those are visible in the code they are editing. All of them are in the graph.
