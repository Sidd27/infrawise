---
title: Reviewing a pull request that touches infrastructure
description: Infrawise shows a reviewer what a changed handler actually reaches, whether its IAM role permits it, and turns team conventions into a CI gate instead of review comments.
---

The expensive review misses are not style. They are the handler that calls a service its execution role does not allow, the new queue that shipped without a dead-letter queue, and the consumer whose visibility timeout is shorter than its own runtime. None of those are visible in the diff — they live in the relationship between the code and the account. Infrawise puts that relationship in front of the reviewer, and then removes the need for a reviewer at all on the parts a machine can check.

## What you get

**What the handler really reaches.** `analyze_function` returns every service and table the function accesses, the triggers with their event shapes, and `missingPermissions` — the AWS services the code calls that its execution role does not permit. The classic "we updated the code and forgot the policy" failure becomes a review comment instead of a 3am page.

**The conventions, enforced.** `infrawise check` runs a fresh analysis and exits non-zero when findings reach the `--fail-on` severity (high by default). A queue with no DLQ, a bucket with no encryption, a Lambda still on the 128 MB default — the build fails on the pull request.

**The consumers of anything you are about to change.** The graph's edges list every function that queries a table; `get_topic_details` lists every subscription and its filter policy, and Kafka producer and consumer mappings come from the application code itself. Rename a column or a topic knowing who breaks.

## How to use it

**Review the changed handler:**

```
analyze_function({ function: "handleRefund" })
```

**Check the messaging assumptions the diff depends on:**

```
get_queue_details()
```

Returns DLQ status, `isFifo`, and `visibilityTimeoutSec` per queue. A consumer Lambda whose timeout exceeds one sixth of the queue's visibility timeout will process duplicates — a defect no diff review catches.

**Wire it into CI:**

```bash
infrawise check --fail-on high
```

Exits non-zero on high-severity findings. Run it as a required check so the standard applies to every pull request, not just the ones a senior engineer happens to read carefully.

## Why this matters

Review attention is finite and expensive. Anything a rule can decide — DLQ coverage, encryption, default memory, rotation — should be decided by the rule, so the human attention goes to the design questions that actually need judgment.
