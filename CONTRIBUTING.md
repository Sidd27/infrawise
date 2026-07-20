# Contributing to infrawise

## Setup

```bash
git clone https://github.com/Sidd27/infrawise
cd infrawise
pnpm install
pnpm build
```

Run the full check before any PR:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

---

## How to add a new AWS service adapter

This is the most common contribution. Each adapter extracts metadata from one AWS service and returns typed structs that flow into the graph engine. The walkthrough below uses S3 as the worked example (S3 support is already merged — the pattern is illustrative).

**1. Add your types to `src/types.ts`**

```ts
export interface S3BucketMetadata {
  name: string;
  arn: string;
  versioned: boolean;
  encrypted: boolean;
  publicAccessBlocked: boolean | null;
}
```

**2. Create the extractor in `src/adapters/aws/`**

```ts
// src/adapters/aws/s3.ts
import { S3Client, ListBucketsCommand, GetBucketEncryptionCommand } from '@aws-sdk/client-s3';
import type { S3BucketMetadata } from '../../types.js';

export async function extractS3Metadata(cfg: { region?: string; profile?: string }): Promise<S3BucketMetadata[]> {
  const client = new S3Client({ region: cfg.region ?? 'us-east-1' });
  const { Buckets = [] } = await client.send(new ListBucketsCommand({}));
  // ... extract and return metadata
  return buckets;
}
```

Follow the pattern from `src/adapters/aws/services.ts` for credential handling.

**3. Export from `src/adapters/aws/index.ts`**

```ts
export { extractS3Metadata } from './s3.js';
```

**4. Wire into `src/cli/commands/analyze.ts`**

Add the extractor call alongside the other AWS services. Gate it on `config.s3?.enabled === true`.

**5. Add to `infrawise.yaml` config schema in `src/core/config.ts`**

```ts
s3: z.object({ enabled: z.boolean().default(false) }).optional(),
```

**6. Add to `src/cli/commands/doctor.ts`** (optional but encouraged)

Add a connectivity check so `infrawise doctor` validates S3 access.

**7. Write tests**

Create `src/adapters/aws/__tests__/s3.test.ts`. Mock the AWS SDK client and test that your extractor handles normal responses, empty responses, and errors.

---

## How to add a new analyzer

Analyzers consume the infrastructure graph and emit findings. They live in `src/analyzers/` and implement a single interface.

**1. Create your analyzer**

```ts
// src/analyzers/s3PublicAccess.ts
import type { Analyzer, SystemGraph, Finding } from '../types.js';

export class S3PublicAccessAnalyzer implements Analyzer {
  name = 'S3PublicAccessAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const node of graph.nodes) {
      if (node.type === 'bucket' && node.publicAccess) {
        findings.push({
          severity: 'high',
          issue: `S3 bucket "${node.name}" has public access enabled`,
          description: `"${node.name}" is publicly accessible. This may expose sensitive data.`,
          recommendation: 'Disable public access via S3 Block Public Access settings.',
          metadata: { resourceType: 's3_bucket', name: node.name },
        });
      }
    }

    return findings;
  }
}
```

**2. Export from `src/analyzers/index.ts`**

**3. Register in `src/cli/commands/analyze.ts`**

Add to the analyzers array, gated on `config.s3?.enabled`.

**4. Write tests**

Create `src/analyzers/__tests__/s3.test.ts`. Build a minimal mock graph with the node types your analyzer cares about and assert the expected findings.

---

## How to add a new database adapter

Same pattern as AWS adapters but lives in `src/adapters/db/`. See `src/adapters/db/postgres.ts` for a reference implementation. The extractor should return table/collection metadata including column names and existing indexes.

---

## PR checklist

- `pnpm lint` passes
- `pnpm typecheck` passes
- `pnpm test` passes (and new code has tests)
- New analyzer has at least one positive and one negative test case
- No hardcoded AWS regions, credentials, or connection strings
- `infrawise.yaml` config example updated if you added a new service key
- README `Analysis capabilities` table updated if you added new checks

---

## Good first issues

Look for issues tagged [`good first issue`](https://github.com/Sidd27/infrawise/labels/good%20first%20issue) on GitHub. These are self-contained changes with clear scope — typically a new analyzer rule, a new config option, or an improvement to an existing extractor.

If you want to add support for a service that isn't listed yet (ECS, for example), open an issue first to align on the approach before writing code.

---

## Questions

Open a [GitHub Discussion](https://github.com/Sidd27/infrawise/discussions) or file an issue.
