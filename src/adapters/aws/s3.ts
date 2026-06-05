import {
  S3Client,
  ListBucketsCommand,
  GetBucketNotificationConfigurationCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetPublicAccessBlockCommand,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import type { S3BucketMetadata, S3EventNotification } from '../../types.js';
import { logger } from '../../core/index.js';

interface AWSConfig {
  region?: string;
  profile?: string;
  endpoint?: string;
}

function validateEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid aws.endpoint URL: "${endpoint}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`aws.endpoint must use http:// or https://, got "${url.protocol}//"`);
  }
}

function clientConfig(cfg: AWSConfig) {
  const region = cfg.region ?? 'us-east-1';
  const base: Record<string, unknown> = { region };
  if (cfg.endpoint) {
    validateEndpoint(cfg.endpoint);
    base.endpoint = cfg.endpoint;
  }
  if (cfg.profile) base.credentials = fromIni({ profile: cfg.profile });
  return base;
}

export async function extractS3Metadata(cfg: AWSConfig = {}): Promise<S3BucketMetadata[]> {
  const client = new S3Client(clientConfig(cfg));
  const buckets: S3BucketMetadata[] = [];

  try {
    const listRes = await client.send(new ListBucketsCommand({}));
    const rawBuckets = (listRes.Buckets ?? []).slice(0, 200);

    for (const bucket of rawBuckets) {
      const name = bucket.Name ?? '';
      if (!name) continue;
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

      const versioned =
        versionResult.status === 'fulfilled' ? versionResult.value.Status === 'Enabled' : false;

      const encrypted =
        encryptResult.status === 'fulfilled'
          ? (encryptResult.value.ServerSideEncryptionConfiguration?.Rules?.length ?? 0) > 0
          : false;

      let publicAccessBlocked: boolean | null = null;
      if (pabResult.status === 'fulfilled') {
        const pab = pabResult.value.PublicAccessBlockConfiguration ?? {};
        publicAccessBlocked = !!(
          pab.BlockPublicAcls &&
          pab.IgnorePublicAcls &&
          pab.BlockPublicPolicy &&
          pab.RestrictPublicBuckets
        );
      } else {
        const httpStatus = (pabResult.reason as { $metadata?: { httpStatusCode?: number } })
          ?.$metadata?.httpStatusCode;
        if (httpStatus !== 403) publicAccessBlocked = false;
        // 403 AccessDenied: leave as null — insufficient permissions, not a public access finding
      }

      buckets.push({
        name,
        arn,
        createdAt,
        versioned,
        encrypted,
        publicAccessBlocked,
        notifications,
      });
    }
  } catch (err) {
    logger.warn(`S3 list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return buckets;
}

export async function validateS3Access(cfg: AWSConfig = {}): Promise<void> {
  await new S3Client(clientConfig(cfg)).send(new ListBucketsCommand({}));
}
