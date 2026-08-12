---
title: How Infrawise handles staleness
description: Why a confidently wrong answer about your infrastructure is worse than a vague one, how Infrawise reports the age of its snapshot, where age-based staleness misleads, and what real drift detection would take.
---

Your assistant tells you the payments queue has a dead-letter queue configured, and names it: `payments-dlq`. It gives you the ARN. You are mid-change, on a deadline, and the answer is specific enough that you do not go check.

It was true on Monday. On Tuesday someone rewrote that stack and the DLQ redrive policy did not survive the rename. The snapshot Infrawise answered from was taken Monday afternoon.

This is the failure mode worth designing against, and it is not the same as an assistant being vague. A vague answer — "I think there's a DLQ, worth confirming" — sends you to the console. A specific answer with a real ARN in it does not. **Grounding an assistant in real infrastructure raises the cost of being out of date**, because the confidence it projects is genuine even when the facts underneath have expired.

## Why tool calls answer from a snapshot

`infrawise analyze` reads your cloud account, your databases, and your IaC files once, and caches the result. Every MCP tool then answers from that cache. No tool call re-reads AWS.

That is a deliberate trade. Live reads on every tool call would mean an assistant asking six questions in a row hits your account six times, each call waiting on the AWS API — and an assistant exploring a codebase asks a lot of questions. Snapshot answers are fast, cheap, and predictable.

The cost is that every answer has an age, and something has to tell you what it is.

## What gets reported

Every tool response carries a `dataHealth` block. The two fields that matter most here:

- `analyzedAt` / `ageSeconds` — when the infrastructure was **read**
- `suggestRefresh` — a coarse verdict, true past 6 hours by default

`ageSeconds` is the fact. `suggestRefresh` is one opinion rendered on top of it, for callers that would rather not reason about a number. Where they disagree with your read of the question in front of you, trust the number.

Field-by-field detail is in the [data freshness reference](/infrawise/reference/data-freshness/).

## Age is not drift

Here is the part worth being honest about: age is a **proxy** for drift, and it is wrong in both directions.

A three-day-old snapshot of an account nobody touched is completely accurate. A five-minute-old snapshot, taken thirty seconds before a colleague ran `terraform apply`, is not. Every threshold you pick — 6 hours, 2 hours, 30 minutes — is a guess about a change rate that is different for every account and every week.

So `suggestRefresh: false` means "this was read recently". It does not mean "this was verified against your account". Infrawise deliberately does not claim the second thing, because with age alone it cannot know it.

Two sources are the exception, because they are checked against reality rather than a clock:

**Your code.** The MCP server watches your source files. Editing code that touches infrastructure rebuilds the graph immediately. Note that `analyzedAt` deliberately does *not* move when this happens — the cloud facts in that rebuilt graph are exactly as old as they were before, and reporting the rebuild time as freshness would be a lie about where those facts came from.

**Your CDK output.** `dataHealth.iac` compares `cdk.out` against the analysis and reports `changed` when someone has run `cdk synth` since. `get_stack_outputs` goes further, cross-checking each template against `cdk.out/manifest.json`: a template the manifest no longer lists is an orphan from a deleted or renamed stack, so its resources are excluded from the graph entirely and its outputs come back marked `stale`.

For everything living in your AWS account, age is currently all Infrawise has.

## What real drift detection would take

Worth writing down, because the shape of the answer is not obvious.

The tempting version — have the tool check for drift before answering — does not work. Asking AWS whether something changed costs roughly what re-reading it costs, so a per-call check would put an API round trip on the path of every question, which is the thing the snapshot model exists to avoid.

The version that could work runs **off** the request path. AWS CloudTrail's `LookupEvents` returns management-plane mutations since a given time — `CreateTable`, `UpdateFunctionConfiguration`, `SetQueueAttributes` — with resource names attached. One call answers "did anything change, and what". Polled in the background and cached, it would turn `suggestRefresh` from a clock reading into a fact, and would let a refresh re-read only the services that actually moved. It has to be background work: `LookupEvents` is rate-limited, and events take five to fifteen minutes to arrive, so polling faster than they land buys nothing.

Databases need something else, since an `ALTER TABLE` never reaches CloudTrail. There the cheap answer is a checksum over `information_schema.columns` — one query, exact answer, no heuristic.

Neither is built today. This section describes a direction, not a feature.

## What to do in the meantime

**Pass `maxAgeSeconds` on point-in-time questions.** "Does this queue have a DLQ right now" deserves a tolerance; "what does this table's schema look like" does not. The response reports whether the data met it. It is advisory — the data still comes back, marked — so it informs the answer rather than blocking it.

**Tune the threshold to your account.** Six hours is a default, not a recommendation:

```yaml
freshness:
  suggestRefreshAfterHours: 2
```

A solo project where infrastructure changes monthly should raise it; a shared account with deploys through the day should lower it. If you keep refreshing because the hint fired and the data was fine every time, it is too low, and you are training yourself to ignore it.

**Ask your assistant to date its claims.** This costs nothing and does the most work. `dataHealth.analyzedAt` is in every response, but nothing makes an assistant repeat it to you. A line in your `CLAUDE.md` or equivalent — *when stating infrastructure facts from Infrawise, include when the snapshot was taken* — puts "as of Monday 3pm" next to the DLQ claim, where you will see it before you act on it. Machine-readable metadata that never reaches the human protects nobody.

**Re-analyze at the boundaries that matter.** Before a release, after someone else's deploy, when picking a session back up the next morning. `infrawise analyze` is the refresh, and `infrawise check` runs a fresh analysis every time by design, so CI never reads from a cache.

You do not need to restart anything to pick that up. A running MCP server rechecks its cache on every tool call, so running `infrawise analyze` in a second terminal reaches the session your editor already has open, on its next question.
