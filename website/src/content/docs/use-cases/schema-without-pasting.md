---
title: Writing database code without pasting your schema
description: Your assistant reads partition keys, columns, foreign keys, and indexes straight from the live database through infrawise — no copy-pasting table definitions into the chat, no stale schema in the context window.
---

This is the problem infrawise was built for. Every session starts the same way: open the console, copy the table definitions, paste them into the chat, and hope the copy is complete. It never is. The pasted schema is missing the indexes, the foreign keys, or the sort key — and it is wrong the moment someone else runs a migration. Then you do it again tomorrow, in the next session, for the next table.

Infrawise removes the ritual. Your assistant reads the schema from the live database on demand, mid-conversation, at the moment it needs it.

## What your assistant sees

**Relational tables.** Columns with their data types and nullability, primary keys, foreign keys with the table and column they reference — the actual join paths — and every index.

**DynamoDB tables.** Partition key, sort key, billing mode, provisioned throughput, and the global secondary indexes with their key schemas. This is what determines whether a query is a `Query` or an expensive `Scan`, and it is exactly what gets guessed wrong when it is absent.

**MongoDB collections.** Indexes with their keys, uniqueness, and sparseness, plus an estimated document count.

Row data is never included. Infrawise reads structure, never contents.

## How to use it

**Fetch only the tables you need:**

```
get_table_schema({ tables: ["orders", "customers"] })
```

Short names match qualified ones — `orders` matches `public.orders`, case-insensitively — and a name can match tables in more than one database. Unknown names come back with up to five suggestions, so a typo produces a correction instead of a hallucinated column.

**Get the inventory first if you do not know the table names:**

```
get_infra_overview()
```

Returns every table with its database type. This is the progressive-disclosure path: the overview gives you names, `get_table_schema` gives you detail for the two or three you actually need, and the other 200 tables never enter the context window.

**Then ask for the index you are missing:**

```
suggest_gsi({ table: "orders", attribute: "customerId" })
postgres_index_suggestions({ table: "orders", column: "customer_id" })
```

Returns a ready-to-apply GSI definition or a `CREATE INDEX CONCURRENTLY` statement, with the rationale.

## Why this matters

A pasted schema is a snapshot that starts decaying immediately. A tool call is a question answered against the live account every time it is asked. The difference shows up as correct column names, correct join paths, queries that use a partition key instead of scanning a table, and one fewer thing you have to remember to do at the start of every session.

Nothing is configured for this. `infrawise start` discovers the databases already reachable from your project, and the schema is available from the first prompt onward.
