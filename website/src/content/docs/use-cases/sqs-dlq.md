---
title: Finding SQS queues without dead-letter queues before messages disappear
description: Infrawise flags SQS queues with no dead-letter queue configured — including queues that trigger Lambdas — so failed messages don't silently vanish.
---

SQS queues without a dead-letter queue (DLQ) lose messages permanently. When a consumer fails to process a message and exhausts its `maxReceiveCount` retries, the message is deleted. There is no error, no alert, and no record that the message ever existed. Infrawise flags this pattern as a high-severity finding so you can catch it before it causes silent data loss in production.

## What Infrawise detects

**Queue with no DLQ — high severity**

Any SQS queue that has no dead-letter queue configured is flagged at high severity. The finding names the specific queue and explains that failed messages will be discarded after `maxReceiveCount` retries with no failure record.

**Lambda triggered by a queue with no DLQ — high severity**

This is the more dangerous variant. If a Lambda function is triggered by an SQS queue, and that queue has no DLQ, failed Lambda invocations have nowhere to route. Infrawise flags this at high severity on the Lambda itself, identifying both the function name and the source queue.

**Large message backlog — medium severity**

If any queue has more than 1,000 messages waiting, Infrawise surfaces a medium-severity finding. A growing backlog typically means consumers are falling behind, scaled incorrectly, or failing silently.

**Unencrypted queue — low severity**

Queues without server-side encryption are flagged at low severity. Infrawise recommends enabling SQS-managed SSE or a KMS key.

## How to use it

**Check DLQ status across all queues:**

```
get_queue_details()
```

Returns every SQS queue with its name, DLQ status, encryption status, approximate message count, retention period in days, and any findings. One call shows the full messaging picture.

**Check whether a specific Lambda's trigger has a DLQ:**

```
analyze_function({ function: "processOrder" })
```

Returns the function's trigger source and whether that source queue has a DLQ configured. If it doesn't, the finding appears in the response with an exact recommendation.

**See all high-severity messaging findings immediately:**

```
get_infra_overview()
```

High-severity findings — including missing DLQ findings — appear in the overview response without needing to inspect each queue.

## Why this matters

AI coding assistants write SQS consumer code without knowing your queue configuration. Claude Code might write a perfectly correct handler for `event.Records[0].body`, but if the underlying queue has no DLQ, any unhandled exception in that handler will silently discard the message after retries. Infrawise tells the AI about the missing DLQ during the same session — so it can flag the issue or generate the missing Terraform resource before the code ships.

---

## FAQ

### What is a dead-letter queue?

A dead-letter queue is a separate SQS queue that receives messages that failed to process after a configured number of retries (`maxReceiveCount`). Without one, failed messages are permanently deleted.

### Does Infrawise automatically add DLQs?

No. Infrawise only reads your infrastructure. It generates findings and recommendations but never creates or modifies AWS resources.

### What counts as a large backlog?

Infrawise flags a queue at medium severity when its approximate message count exceeds 1,000. This threshold is a default; actual severity depends on your expected throughput.

### Does Infrawise check FIFO queues too?

Infrawise analyzes all SQS queues returned by your AWS account configuration. FIFO and standard queues are both included.
