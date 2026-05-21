import {
  SQSClient,
  ListQueuesCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import {
  SNSClient,
  ListTopicsCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
} from '@aws-sdk/client-sns';
import {
  SSMClient,
  DescribeParametersCommand,
} from '@aws-sdk/client-ssm';
import {
  SecretsManagerClient,
  ListSecretsCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  LambdaClient,
  ListFunctionsCommand,
} from '@aws-sdk/client-lambda';
import {
  RDSClient,
  DescribeDBInstancesCommand,
} from '@aws-sdk/client-rds';
import { fromIni } from '@aws-sdk/credential-providers';
import type {
  SQSQueueMetadata,
  SNSTopicMetadata,
  SSMParameterMetadata,
  SecretsManagerMetadata,
  LambdaFunctionMetadata,
  RDSInstanceMetadata,
} from '../types.js';
import { logger } from '../core/index.js';

interface AWSConfig {
  region?: string;
  profile?: string;
  endpoint?: string;
}

function clientConfig(cfg: AWSConfig) {
  const region = cfg.region ?? 'us-east-1';
  const base: Record<string, unknown> = { region };
  if (cfg.endpoint) base.endpoint = cfg.endpoint;
  if (cfg.profile) base.credentials = fromIni({ profile: cfg.profile });
  return base;
}

// ─── SQS ─────────────────────────────────────────────────────────────────────

export async function extractSQSMetadata(cfg: AWSConfig = {}): Promise<SQSQueueMetadata[]> {
  const client = new SQSClient(clientConfig(cfg));
  const queues: SQSQueueMetadata[] = [];

  try {
    let nextToken: string | undefined;
    const queueUrls: string[] = [];
    do {
      const res = await client.send(new ListQueuesCommand({ NextToken: nextToken, MaxResults: 1000 }));
      queueUrls.push(...(res.QueueUrls ?? []));
      nextToken = res.NextToken;
    } while (nextToken);

    for (const url of queueUrls) {
      try {
        const attrs = await client.send(new GetQueueAttributesCommand({
          QueueUrl: url,
          AttributeNames: [
            'QueueArn', 'VisibilityTimeout', 'MessageRetentionPeriod',
            'RedrivePolicy', 'KmsMasterKeyId', 'SqsManagedSseEnabled',
            'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible',
          ],
        }));
        const a = attrs.Attributes ?? {};
        const arn = a['QueueArn'] ?? '';
        const name = arn.split(':').pop() ?? url.split('/').pop() ?? url;
        const redrivePolicy = a['RedrivePolicy'];
        const dlqArn = redrivePolicy
          ? (JSON.parse(redrivePolicy) as { deadLetterTargetArn?: string }).deadLetterTargetArn
          : undefined;
        const encrypted = !!(a['KmsMasterKeyId'] || a['SqsManagedSseEnabled'] === 'true');
        const retentionSeconds = parseInt(a['MessageRetentionPeriod'] ?? '345600', 10);

        queues.push({
          name,
          url,
          arn,
          hasDLQ: !!dlqArn,
          dlqArn,
          encrypted,
          visibilityTimeoutSec: parseInt(a['VisibilityTimeout'] ?? '30', 10),
          retentionDays: Math.round(retentionSeconds / 86400),
          approximateMessages: parseInt(a['ApproximateNumberOfMessages'] ?? '0', 10),
          approximateInflight: parseInt(a['ApproximateNumberOfMessagesNotVisible'] ?? '0', 10),
        });
      } catch (err) {
        logger.warn(`SQS attrs failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`SQS list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return queues;
}

export async function validateSQSAccess(cfg: AWSConfig = {}): Promise<void> {
  await new SQSClient(clientConfig(cfg)).send(new ListQueuesCommand({ MaxResults: 1 }));
}

// ─── SNS ─────────────────────────────────────────────────────────────────────

export async function extractSNSMetadata(cfg: AWSConfig = {}): Promise<SNSTopicMetadata[]> {
  const client = new SNSClient(clientConfig(cfg));
  const topics: SNSTopicMetadata[] = [];

  try {
    let nextToken: string | undefined;
    const topicArns: string[] = [];
    do {
      const res = await client.send(new ListTopicsCommand({ NextToken: nextToken }));
      topicArns.push(...(res.Topics ?? []).map((t) => t.TopicArn ?? '').filter(Boolean));
      nextToken = res.NextToken;
    } while (nextToken);

    for (const arn of topicArns) {
      try {
        const [attrsRes, subsRes] = await Promise.all([
          client.send(new GetTopicAttributesCommand({ TopicArn: arn })),
          client.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn })),
        ]);
        const attrs = attrsRes.Attributes ?? {};
        const subs = subsRes.Subscriptions ?? [];

        topics.push({
          name: arn.split(':').pop() ?? arn,
          arn,
          encrypted: !!attrs['KmsMasterKeyId'],
          subscriptionCount: parseInt(attrs['SubscriptionsConfirmed'] ?? '0', 10),
          subscriptionProtocols: [...new Set(subs.map((s) => s.Protocol ?? 'unknown'))],
        });
      } catch (err) {
        logger.warn(`SNS attrs failed for ${arn}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`SNS list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return topics;
}

export async function validateSNSAccess(cfg: AWSConfig = {}): Promise<void> {
  await new SNSClient(clientConfig(cfg)).send(new ListTopicsCommand({}));
}

// ─── SSM Parameter Store ──────────────────────────────────────────────────────

export async function extractSSMMetadata(
  cfg: AWSConfig & { paths?: string[] } = {},
): Promise<SSMParameterMetadata[]> {
  const client = new SSMClient(clientConfig(cfg));
  const parameters: SSMParameterMetadata[] = [];

  try {
    let nextToken: string | undefined;
    do {
      const res = await client.send(new DescribeParametersCommand({
        NextToken: nextToken,
        MaxResults: 50,
        ParameterFilters: cfg.paths?.length
          ? [{ Key: 'Path', Values: cfg.paths, Option: 'Recursive' }]
          : undefined,
      }));
      for (const p of res.Parameters ?? []) {
        parameters.push({
          name: p.Name ?? '',
          type: p.Type ?? 'String',
          tier: p.Tier ?? 'Standard',
          lastModified: p.LastModifiedDate?.toISOString(),
          description: p.Description,
          keyId: p.KeyId,
        });
      }
      nextToken = res.NextToken;
    } while (nextToken && parameters.length < 500);
  } catch (err) {
    logger.warn(`SSM list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parameters;
}

export async function validateSSMAccess(cfg: AWSConfig = {}): Promise<void> {
  await new SSMClient(clientConfig(cfg)).send(new DescribeParametersCommand({ MaxResults: 1 }));
}

// ─── Secrets Manager ──────────────────────────────────────────────────────────

export async function extractSecretsMetadata(cfg: AWSConfig = {}): Promise<SecretsManagerMetadata[]> {
  const client = new SecretsManagerClient(clientConfig(cfg));
  const secrets: SecretsManagerMetadata[] = [];

  try {
    let nextToken: string | undefined;
    do {
      // ListSecrets never returns secret values
      const res = await client.send(new ListSecretsCommand({ NextToken: nextToken, MaxResults: 100 }));
      for (const s of res.SecretList ?? []) {
        secrets.push({
          name: s.Name ?? '',
          arn: s.ARN ?? '',
          rotationEnabled: s.RotationEnabled ?? false,
          rotationDays: s.RotationRules?.AutomaticallyAfterDays,
          lastRotated: s.LastRotatedDate?.toISOString(),
          lastAccessed: s.LastAccessedDate?.toISOString(),
          description: s.Description,
        });
      }
      nextToken = res.NextToken;
    } while (nextToken && secrets.length < 200);
  } catch (err) {
    logger.warn(`Secrets Manager list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return secrets;
}

export async function validateSecretsAccess(cfg: AWSConfig = {}): Promise<void> {
  await new SecretsManagerClient(clientConfig(cfg)).send(new ListSecretsCommand({ MaxResults: 1 }));
}

// ─── Lambda ───────────────────────────────────────────────────────────────────

export async function extractLambdaMetadata(cfg: AWSConfig = {}): Promise<LambdaFunctionMetadata[]> {
  const client = new LambdaClient(clientConfig(cfg));
  const functions: LambdaFunctionMetadata[] = [];

  try {
    let marker: string | undefined;
    do {
      const res = await client.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
      for (const fn of res.Functions ?? []) {
        functions.push({
          name: fn.FunctionName ?? '',
          arn: fn.FunctionArn ?? '',
          runtime: fn.Runtime,
          handler: fn.Handler,
          memoryMB: fn.MemorySize,
          timeoutSec: fn.Timeout,
          lastModified: fn.LastModified,
          envVarKeys: Object.keys(fn.Environment?.Variables ?? {}),
          layers: (fn.Layers ?? []).map((l) => l.Arn ?? '').filter(Boolean),
        });
      }
      marker = res.NextMarker;
    } while (marker && functions.length < 200);
  } catch (err) {
    logger.warn(`Lambda list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return functions;
}

export async function validateLambdaAccess(cfg: AWSConfig = {}): Promise<void> {
  await new LambdaClient(clientConfig(cfg)).send(new ListFunctionsCommand({ MaxItems: 1 }));
}

// ─── RDS ─────────────────────────────────────────────────────────────────────

export async function extractRDSMetadata(cfg: AWSConfig = {}): Promise<RDSInstanceMetadata[]> {
  const client = new RDSClient(clientConfig(cfg));
  const instances: RDSInstanceMetadata[] = [];

  try {
    let marker: string | undefined;
    do {
      const res = await client.send(new DescribeDBInstancesCommand({ Marker: marker, MaxRecords: 100 }));
      for (const db of res.DBInstances ?? []) {
        instances.push({
          dbInstanceIdentifier: db.DBInstanceIdentifier ?? '',
          engine: db.Engine ?? '',
          engineVersion: db.EngineVersion ?? '',
          instanceClass: db.DBInstanceClass ?? '',
          publiclyAccessible: db.PubliclyAccessible ?? false,
          storageEncrypted: db.StorageEncrypted ?? false,
          backupRetentionDays: db.BackupRetentionPeriod ?? 0,
          deletionProtection: db.DeletionProtection ?? false,
          multiAZ: db.MultiAZ ?? false,
          dbInstanceStatus: db.DBInstanceStatus ?? '',
        });
      }
      marker = res.Marker;
    } while (marker && instances.length < 200);
  } catch (err) {
    logger.warn(`RDS list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return instances;
}

export async function validateRDSAccess(cfg: AWSConfig = {}): Promise<void> {
  await new RDSClient(clientConfig(cfg)).send(new DescribeDBInstancesCommand({ MaxRecords: 20 }));
}
