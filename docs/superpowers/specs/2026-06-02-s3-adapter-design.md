# S3 Buckets + Event Notifications — Design Spec

**Date:** 2026-06-02
**Issue:** S3 buckets + event notifications (P0, Complexity: Low)
**Status:** Approved

## Problem

Claude Code doesn't know S3 bucket names or which events fire on PUT/DELETE. This causes:
1. Hardcoded bucket names in generated code — breaks across envs (dev/staging/prod have different names)
2. Wrong or missing event shapes for S3-triggered Lambdas — `event.body` instead of `event.Records[0].s3.object.key`
3. Silent async pipeline failures — Claude Code doesn't know which Lambda a bucket notification invokes

S3 → Lambda notifications are **push-based**, configured on the bucket via `GetBucketNotificationConfiguration`. They are NOT covered by `ListEventSourceMappings` (which only covers SQS, DynamoDB Streams, Kinesis, MSK). So today, a Lambda triggered exclusively by S3 shows zero triggers in `analyze_function` and `get_lambda_overview`.

## Approach

Option A (selected): Separate `src/adapters/aws/s3.ts` adapter file. Analyzers added to existing `aws-services.ts`. Follows the exact established pattern.

---

## Types (`src/types.ts`)

### New interfaces

```ts
export interface S3EventNotification {
  events: string[];       // e.g. ['s3:ObjectCreated:*', 's3:ObjectRemoved:Delete']
  lambdaArn: string;
  lambdaName: string;     // last segment of ARN
  prefix?: string;        // key filter prefix
  suffix?: string;        // key filter suffix
}

export interface S3BucketMetadata {
  name: string;
  arn: string;
  createdAt?: string;           // ISO string from ListBuckets CreationDate
  versioned: boolean;           // VersioningConfiguration.Status === 'Enabled'
  encrypted: boolean;           // any SSE rule present (SSE-S3 or KMS)
  publicAccessBlocked: boolean; // all 4 BlockPublicAccess flags true
  notifications: S3EventNotification[];
}
```

### Additions to existing types

**`ServicesMeta`**: add `s3?: S3BucketMetadata[]`

**`InfrawiseConfig`**: add `s3?: { enabled?: boolean }`

**`LambdaTrigger`**: add `events?: string[]` — the S3 event types (e.g. `s3:ObjectCreated:*`) so `analyze_function` can show which events fire the function

**`GraphNode` `bucket` member**: add `encrypted?: boolean` and `publicAccessBlocked?: boolean` to the existing union member

---

## Adapter (`src/adapters/aws/s3.ts`)

### API calls

One `ListBuckets` call, then for each bucket (capped at 200), four concurrent calls via `Promise.allSettled`:

```
ListBuckets
  → for each bucket (max 200):
      Promise.allSettled([
        GetBucketNotificationConfiguration,  → notifications
        GetBucketVersioning,                 → versioned
        GetBucketEncryption,                 → encrypted
        GetPublicAccessBlock,                → publicAccessBlocked
      ])
```

### Key decisions

- **Notifications**: Only `LambdaFunctionConfigurations` extracted. SQS/SNS notification targets are out of scope for this issue. Per config: extract `Events[]`, `LambdaFunctionArn`, and key filter prefix/suffix from `Filter.Key.FilterRules`.
- **Versioning**: `Status === 'Enabled'` → `true`. `Suspended` or missing → `false`.
- **Encryption**: Any `ServerSideEncryptionConfiguration.Rules` present → `true`. Covers both SSE-S3 and KMS.
- **PublicAccessBlock**: All four flags (`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`) must be `true`. If `GetPublicAccessBlock` returns ResourceNotFound (no block config set) → `false`.
- **Per-bucket errors**: Swallowed with `logger.warn`, same pattern as SQS/SNS adapters. One inaccessible bucket does not abort the rest.
- **Cap**: 200 buckets, consistent with secrets/lambda caps.

### Exports

```ts
export async function extractS3Metadata(cfg: AWSConfig): Promise<S3BucketMetadata[]>
export async function validateS3Access(cfg: AWSConfig): Promise<void>  // calls ListBuckets
```

`src/adapters/aws/index.ts` re-exports both.

---

## Graph Building (`src/graph/index.ts`)

### `nodeMap` cleanup

Add `nodeMap: Map<string, GraphNode>` maintained in sync with `nodes` array. Every `addNode` call also sets `nodeMap.set(node.id, node)`. Replaces all `nodes.find((n) => n.id === ...)` lookups — currently used in EventBridge target wiring and `LambdaMissingTriggerDLQAnalyzer`. Makes all back-propagation O(1) regardless of scale.

**Test requirement:** The `nodeMap` refactor must be covered by tests before any S3 logic is added. Specifically verify that existing EventBridge → Lambda trigger wiring and Lambda trigger DLQ detection produce identical results before and after the refactor. Tests live in the existing `src/graph/__tests__/builder.test.ts`. Run `pnpm test` after the refactor step to confirm no regressions before proceeding.

### S3 bucket nodes + back-propagation

```
for each S3BucketMetadata in servicesMeta.s3:
  addNode({
    id: 'bucket:aws:{name}', type: 'bucket', name,
    provider: 'aws', versioned, encrypted, publicAccessBlocked
  })

  for each notification:
    lambdaId = 'lambda:aws:{notification.lambdaName}'
    if nodeMap.has(lambdaId):
      add edge: bucket → lambda, type: 'triggers'
      get lambdaNode from nodeMap
      push to lambdaNode.triggers:
        {
          type: 's3',
          sourceArn: bucketArn,
          sourceName: bucketName,
          eventShape: 'event.Records[0].s3.object.key',
          events: notification.events,
          ...(notification.prefix && { prefix: notification.prefix }),
          ...(notification.suffix && { suffix: notification.suffix }),
        }
```

**Guard**: Lambda nodes are added from `servicesMeta.lambda` earlier in the same loop. If Lambda extraction is disabled, no lambda nodes exist — S3 notification edges are silently skipped. Same pattern as EventBridge → Lambda wiring.

### New graph selector

```ts
export function getBucketNodes(graph: SystemGraph): Extract<GraphNode, { type: 'bucket' }>[]
```

---

## MCP Tool (`src/server/index.ts`)

### `get_s3_overview`

No inputs required.

**When to call:** When checking which S3 buckets exist, what events they fire, which Lambda handles each event, or before writing S3 upload/delete handlers to get the correct event shape and bucket name. Do NOT call when you only need a quick infrastructure count — use `get_infra_overview` for that.

**Returns:**

```json
{
  "total": 3,
  "note": "Event notification configs shown; object contents are never included.",
  "buckets": [
    {
      "name": "my-uploads-bucket",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "versioned": true,
      "encrypted": true,
      "publicAccessBlocked": true,
      "notifications": [
        {
          "events": ["s3:ObjectCreated:*"],
          "lambdaName": "processUpload",
          "prefix": "uploads/",
          "suffix": ".jpg"
        }
      ],
      "findings": [{ "severity": "medium", "issue": "..." }]
    }
  ]
}
```

Findings correlated by `metadata.bucketName`, same pattern as `get_queue_details` / `get_secrets_overview`.

### `get_infra_overview` update

Add `buckets: buckets.length` to the `summary` object and `buckets: buckets.map(b => ({ name: b.name, versioned: b.versioned, publicAccessBlocked: b.publicAccessBlocked }))` to the response body.

---

## Analyzers (`src/analyzers/aws-services.ts`)

Three new classes, all iterate `graph.nodes` filtering by `type === 'bucket'`:

### `verify` severity — type change

`Finding.severity` union extended: `'high' | 'medium' | 'low' | 'verify'`

Meaning: intent determines whether this is a problem. Claude Code should surface it for confirmation, not treat it as actionable.

**System-wide `verify` changes:**
- Sort order: `high → medium → low → verify` (verify last)
- `summarizeFindings`: count `verify` separately
- CLI `printFinding`: new icon/color (blue `?`)
- `printSummaryBox`: include verify count
- `get_infra_overview`: `highFindings` filter stays scoped to `severity === 'high'` only

Only `S3PublicAccessAnalyzer` uses `verify`. No existing analyzer severities are changed.

### New analyzers

| Class | Severity | Condition | metadata key |
|---|---|---|---|
| `S3PublicAccessAnalyzer` | `verify` | `publicAccessBlocked === false` | `bucketName` |
| `S3MissingVersioningAnalyzer` | `medium` | `versioned === false` | `bucketName` |
| `S3UnencryptedAnalyzer` | `medium` | `encrypted === false` | `bucketName` |

`S3PublicAccessAnalyzer` description: "Public access blocking is disabled on bucket \"{name}\". This is expected for static website hosting and public asset buckets. Confirm this is intentional before treating it as a security issue."

---

## CLI Wiring

### `src/cli/commands/analyze.ts`

```ts
if (config.s3?.enabled === true) {
  const s = mkSpinner('Extracting S3 buckets...');
  try {
    const result = await extractS3Metadata(awsCfg);
    servicesMeta.s3 = result;
    s.succeed(chalk.green('S3') + chalk.dim(`  ${result.length} bucket(s)`));
  } catch (err) {
    s.warn(chalk.yellow('S3 skipped') + chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
  }
}
```

Analyzers array when `config.s3?.enabled === true`:
```ts
new S3PublicAccessAnalyzer(),
new S3MissingVersioningAnalyzer(),
new S3UnencryptedAnalyzer(),
```

Same block added to `runCodeRefresh`.

### `src/cli/commands/doctor.ts`

Add `validateS3Access` to AWS connectivity checks under the S3 section.

---

## Dependencies

Add to `package.json`:
```json
"@aws-sdk/client-s3": "^3.1048.0"
```

---

## Demo Updates

### `demo/local/infrawise.yaml`
```yaml
s3:
  enabled: false
```

### `demo/localstack/infrawise.yaml`
```yaml
s3:
  enabled: true
```

### `demo/localstack/start.sh` — seed 3 buckets:

1. `uploads-bucket` — versioning enabled, encrypted, public access blocked, Lambda notification on `s3:ObjectCreated:*` targeting an existing Lambda, prefix `uploads/`
2. `assets-bucket` — public (no block config), no versioning, no encryption → fires `S3PublicAccessAnalyzer` (verify) + both medium findings
3. `logs-archive-bucket` — versioning disabled, encrypted, public access blocked → fires `S3MissingVersioningAnalyzer`

This exercises: notification back-propagation to Lambda triggers, all three analyzers, and `get_s3_overview` end-to-end.

---

## Documentation

### `AGENTS.md` — add `get_s3_overview` tool section

### `README.md` — update:
- MCP tools table: add `get_s3_overview` row
- Analysis capabilities table: add S3 row
- Configuration section: add `s3.enabled` option

### `llms.txt` — update tool count + add `get_s3_overview` to tool list

---

## Files Changed Summary

| File | Change |
|---|---|
| `src/types.ts` | Add `S3EventNotification`, `S3BucketMetadata`; extend `ServicesMeta`, `InfrawiseConfig`, `LambdaTrigger`, `GraphNode.bucket`; extend `Finding.severity` with `'verify'` |
| `src/adapters/aws/s3.ts` | **New file** — `extractS3Metadata`, `validateS3Access` |
| `src/adapters/aws/index.ts` | Re-export from `s3.ts` |
| `src/graph/index.ts` | Add `nodeMap`; add S3 bucket node + edge wiring; add `getBucketNodes` selector |
| `src/analyzers/aws-services.ts` | Add `S3PublicAccessAnalyzer`, `S3MissingVersioningAnalyzer`, `S3UnencryptedAnalyzer` |
| `src/analyzers/index.ts` | Export three new S3 analyzers; update `summarizeFindings` to count `verify` |
| `src/server/index.ts` | Add `get_s3_overview` tool; update `get_infra_overview` summary |
| `src/cli/commands/analyze.ts` | Wire S3 extraction + analyzers |
| `src/cli/commands/doctor.ts` | Add `validateS3Access` to AWS connectivity checks |
| `src/cli/utils.ts` | Handle `verify` severity in `printFinding` + `printSummaryBox` |
| `demo/local/infrawise.yaml` | Add `s3: enabled: false` |
| `demo/localstack/infrawise.yaml` | Add `s3: enabled: true` |
| `demo/localstack/start.sh` | Seed 3 S3 buckets |
| `package.json` | Add `@aws-sdk/client-s3` |
| `AGENTS.md` | Add `get_s3_overview` tool reference |
| `README.md` | Update tools table, analysis table, config section |
| `llms.txt` | Update tool count + list |
