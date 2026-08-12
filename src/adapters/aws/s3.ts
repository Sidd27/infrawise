import {
  S3Client,
  ListBucketsCommand,
  GetBucketNotificationConfigurationCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetPublicAccessBlockCommand,
  type Bucket,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import type { S3BucketMetadata, S3EventNotification } from '../../types.js';

interface AWSConfig {
  region?: string;
  profile?: string;
}

function clientConfig(cfg: AWSConfig) {
  const region = cfg.region ?? 'us-east-1';
  const base: Record<string, unknown> = { region };
  if (cfg.profile) base.credentials = fromIni({ profile: cfg.profile });
  return base;
}

// S3 is the one service where the per-resource calls do not share a connection.
// Every other client talks to one regional host, so the SDK reuses a single TLS
// socket for the whole extraction. S3 sub-resource calls are virtual-hosted —
// `<bucket>.s3.<region>.amazonaws.com` — so each bucket is a separate hostname
// with its own DNS lookup and TLS handshake. Walking buckets one at a time pays
// that setup serially, which is why S3 alone took minutes on an account where
// every other service finished in seconds. Overlapping the buckets overlaps the
// handshakes. Bounded, because these sub-resource APIs throttle.
const BUCKET_CONCURRENCY = 8;

function errorName(reason: unknown): string | undefined {
  return (reason as { name?: string })?.name;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function extractS3Metadata(cfg: AWSConfig = {}): Promise<S3BucketMetadata[]> {
  const client = new S3Client(clientConfig(cfg));

  // ListBuckets paginates. The previous cap dropped everything past 200 with no
  // warning, so a large account reported a partial inventory as a complete one —
  // and an absent bucket reads as "does not exist" to anything downstream.
  const rawBuckets: Bucket[] = [];
  let continuationToken: string | undefined;
  do {
    const listRes = await client.send(
      new ListBucketsCommand({ ContinuationToken: continuationToken }),
    );
    rawBuckets.push(...(listRes.Buckets ?? []));
    continuationToken = listRes.ContinuationToken;
  } while (continuationToken);

  const results = await mapWithConcurrency<(typeof rawBuckets)[number], S3BucketMetadata | null>(
    rawBuckets,
    BUCKET_CONCURRENCY,
    async (bucket) => {
      const name = bucket.Name ?? '';
      if (!name) return null;
      const arn = `arn:aws:s3:::${name}`;
      const createdAt = bucket.CreationDate?.toISOString();

      const [notifResult, versionResult, encryptResult, pabResult] = await Promise.allSettled([
        client.send(new GetBucketNotificationConfigurationCommand({ Bucket: name })),
        client.send(new GetBucketVersioningCommand({ Bucket: name })),
        client.send(new GetBucketEncryptionCommand({ Bucket: name })),
        client.send(new GetPublicAccessBlockCommand({ Bucket: name })),
      ]);

      const notifications: S3EventNotification[] = [];
      if (notifResult.status === 'fulfilled') {
        for (const config of notifResult.value.LambdaFunctionConfigurations ?? []) {
          const lambdaArn = config.LambdaFunctionArn ?? '';
          const lambdaName = lambdaArn.split(':').pop() ?? lambdaArn;
          const rules = config.Filter?.Key?.FilterRules ?? [];
          const prefix = rules.find((r) => r.Name?.toLowerCase() === 'prefix')?.Value;
          const suffix = rules.find((r) => r.Name?.toLowerCase() === 'suffix')?.Value;
          const notification: S3EventNotification = {
            events: config.Events ?? [],
            lambdaArn,
            lambdaName,
          };
          if (prefix !== undefined) notification.prefix = prefix;
          if (suffix !== undefined) notification.suffix = suffix;
          notifications.push(notification);
        }
      }

      // A call that failed says nothing about the bucket. Returning false here
      // asserted "not versioned" / "not encrypted" / "not blocked" on evidence
      // nobody read, and the public-access finding is generated from that value.
      // null is the honest answer, and every S3 analyzer tests for `=== false`.
      const versioned =
        versionResult.status === 'fulfilled' ? versionResult.value.Status === 'Enabled' : null;

      // These two APIs answer "not configured" with an error rather than an
      // empty body, so that specific error name is a fact and must stay `false`.
      // Every other failure is absence of information, not absence of config.
      const encrypted =
        encryptResult.status === 'fulfilled'
          ? (encryptResult.value.ServerSideEncryptionConfiguration?.Rules?.length ?? 0) > 0
          : errorName(encryptResult.reason) === 'ServerSideEncryptionConfigurationNotFoundError'
            ? false
            : null;

      let publicAccessBlocked: boolean | null = null;
      if (pabResult.status === 'fulfilled') {
        const pab = pabResult.value.PublicAccessBlockConfiguration ?? {};
        publicAccessBlocked = !!(
          pab.BlockPublicAcls &&
          pab.IgnorePublicAcls &&
          pab.BlockPublicPolicy &&
          pab.RestrictPublicBuckets
        );
      } else if (errorName(pabResult.reason) === 'NoSuchPublicAccessBlockConfiguration') {
        publicAccessBlocked = false;
      }

      return {
        name,
        arn,
        createdAt,
        versioned,
        encrypted,
        publicAccessBlocked,
        notifications,
      };
    },
  );

  return results.filter((b): b is S3BucketMetadata => b !== null);
}

export async function validateS3Access(cfg: AWSConfig = {}): Promise<void> {
  await new S3Client(clientConfig(cfg)).send(new ListBucketsCommand({}));
}
