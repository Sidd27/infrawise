---
title: Getting the Lambda event shape right every time
description: Infrawise tells Claude Code and Cursor the exact event object shape for each Lambda trigger — SQS, S3, SNS, DynamoDB Streams, Kinesis, EventBridge — before you write the handler.
---

Every Lambda trigger type sends a different event structure to your handler. SQS puts the message body at `event.Records[0].body`. S3 notifications put the object key at `event.Records[0].s3.object.key`. SNS wraps the payload inside `event.Records[0].Sns.Message`. Getting this wrong produces a silent runtime failure — the handler runs, no exception is thrown accessing a property on `undefined`, and your message or event is dropped.

Infrawise extracts the trigger configuration from your live AWS account and surfaces the exact event shape alongside every Lambda function — so the AI writing your handler already knows which path to use.

## Event shapes by trigger type

Infrawise maps these event shapes directly from your Lambda event source mappings:

| Trigger | Event shape |
|---|---|
| SQS | `event.Records[0].body` |
| SNS | `event.Records[0].Sns.Message` |
| S3 | `event.Records[0].s3.object.key` |
| DynamoDB Streams | `event.Records[0].dynamodb.NewImage` |
| Kinesis | `event.Records[0].kinesis.data` (base64 encoded) |
| EventBridge | rule name and event pattern returned separately |

These shapes are returned by both `analyze_function` and `get_lambda_overview`.

## How to use it

**Before writing a Lambda handler, call analyze_function:**

```
analyze_function({ function: "processOrder" })
```

Returns the function's file path, which tables and queues it accesses, and for each trigger: the source type, source name, and the exact `event` path the handler should use. If the trigger is EventBridge, it also returns the rule name and event pattern.

**To see trigger shapes across all functions at once:**

```
get_lambda_overview()
```

Returns every Lambda with its runtime, memory, timeout, environment variable key names, and trigger list — each trigger including the event shape.

## Why this matters

Without infrastructure context, an AI coding assistant has no way to know which trigger type is attached to a specific Lambda function. It guesses based on naming conventions or surrounding code. `processOrder` could be triggered by SQS, SNS, EventBridge, or an API Gateway — they all look the same from the source file alone.

With `analyze_function`, the AI receives the actual event source mapping from your AWS account before generating any handler code. If `processOrder` is triggered by SQS, it knows to access `event.Records[0].body`. If it's triggered by DynamoDB Streams, it knows to read `event.Records[0].dynamodb.NewImage`. No guessing, no runtime failures from wrong property paths.

## Kinesis note

Kinesis event data (`event.Records[0].kinesis.data`) is base64 encoded. You need to decode it: `Buffer.from(event.Records[0].kinesis.data, 'base64').toString('utf-8')`. Infrawise surfaces the shape with this note included.

---

## FAQ

### Does Infrawise support all Lambda trigger types?

Infrawise extracts event source mappings for SQS, SNS, S3, DynamoDB Streams, Kinesis, MSK, and EventBridge. Triggers configured outside event source mappings (API Gateway, ALB, Cognito) are not currently included.

### What if a Lambda has multiple triggers?

`analyze_function` and `get_lambda_overview` both return an array of triggers. Each trigger includes its own source type, source name, and event shape.

### Does Infrawise check whether triggers are enabled?

Yes. Each trigger entry includes its state (`ENABLED` or `DISABLED`). Disabled event source mappings are returned but marked accordingly.

### Can I get the EventBridge event pattern for a specific function?

Yes. Call `get_eventbridge_details()` to see all EventBridge rules with their schedule expressions or event patterns and which Lambda functions they target.
