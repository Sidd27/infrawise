import { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import {
  APIGatewayClient,
  GetRestApisCommand,
  GetResourcesCommand,
} from '@aws-sdk/client-api-gateway';
import {
  ApiGatewayV2Client,
  GetApisCommand,
  GetRoutesCommand,
  GetIntegrationsCommand,
} from '@aws-sdk/client-apigatewayv2';
import {
  SNSClient,
  ListTopicsCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  GetSubscriptionAttributesCommand,
} from '@aws-sdk/client-sns';
import { SSMClient, DescribeParametersCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, ListSecretsCommand } from '@aws-sdk/client-secrets-manager';
import {
  LambdaClient,
  ListFunctionsCommand,
  ListEventSourceMappingsCommand,
} from '@aws-sdk/client-lambda';
import {
  EventBridgeClient,
  ListRulesCommand,
  ListTargetsByRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import {
  KinesisClient,
  ListStreamsCommand,
  DescribeStreamSummaryCommand,
} from '@aws-sdk/client-kinesis';
import { KafkaClient, ListClustersV2Command } from '@aws-sdk/client-kafka';
import {
  ElastiCacheClient,
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
} from '@aws-sdk/client-elasticache';
import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  ListUserPoolClientsCommand,
  DescribeUserPoolClientCommand,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  IAMClient,
  ListAttachedRolePoliciesCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  ListRolePoliciesCommand,
  GetRolePolicyCommand,
} from '@aws-sdk/client-iam';
import { fromIni } from '@aws-sdk/credential-providers';
import type {
  SQSQueueMetadata,
  SNSTopicMetadata,
  SNSFilterPolicy,
  SSMParameterMetadata,
  SecretsManagerMetadata,
  LambdaFunctionMetadata,
  LambdaTrigger,
  EventBridgeRuleMetadata,
  RDSInstanceMetadata,
  APIGatewayMetadata,
  APIGatewayRouteMetadata,
  CognitoUserPoolMetadata,
  CognitoAppClientMetadata,
  KinesisStreamMetadata,
  MSKClusterMetadata,
  ElastiCacheClusterMetadata,
} from '../../types.js';
import { logger } from '../../core/index.js';

export interface AWSConfig {
  region?: string;
  profile?: string;
}

export function clientConfig(cfg: AWSConfig) {
  const region = cfg.region ?? 'us-east-1';
  const base: Record<string, unknown> = { region };
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
      const res = await client.send(
        new ListQueuesCommand({ NextToken: nextToken, MaxResults: 1000 }),
      );
      queueUrls.push(...(res.QueueUrls ?? []));
      nextToken = res.NextToken;
    } while (nextToken);

    for (const url of queueUrls) {
      try {
        const attrs = await client.send(
          new GetQueueAttributesCommand({
            QueueUrl: url,
            AttributeNames: [
              'QueueArn',
              'VisibilityTimeout',
              'MessageRetentionPeriod',
              'RedrivePolicy',
              'KmsMasterKeyId',
              'SqsManagedSseEnabled',
              'ApproximateNumberOfMessages',
              'ApproximateNumberOfMessagesNotVisible',
            ],
          }),
        );
        const a = attrs.Attributes ?? {};
        const arn = a['QueueArn'] ?? '';
        const name = arn.split(':').pop() ?? url.split('/').pop() ?? url;
        const redrivePolicy = a['RedrivePolicy'];
        const dlqArn = redrivePolicy
          ? (JSON.parse(redrivePolicy) as { deadLetterTargetArn?: string }).deadLetterTargetArn
          : undefined;
        const encrypted = !!(a['KmsMasterKeyId'] || a['SqsManagedSseEnabled'] === 'true');
        const retentionSeconds = parseInt(a['MessageRetentionPeriod'] ?? '345600', 10);
        const isFifo = name.endsWith('.fifo') || a['FifoQueue'] === 'true';

        queues.push({
          name,
          url,
          arn,
          hasDLQ: !!dlqArn,
          dlqArn,
          encrypted,
          isFifo,
          visibilityTimeoutSec: parseInt(a['VisibilityTimeout'] ?? '30', 10),
          retentionDays: Math.round(retentionSeconds / 86400),
          approximateMessages: parseInt(a['ApproximateNumberOfMessages'] ?? '0', 10),
          approximateInflight: parseInt(a['ApproximateNumberOfMessagesNotVisible'] ?? '0', 10),
        });
      } catch (err) {
        logger.warn(
          `SQS attrs failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
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

        const filterPolicies: SNSFilterPolicy[] = [];
        for (const sub of subs) {
          if (!sub.SubscriptionArn || sub.SubscriptionArn === 'PendingConfirmation') continue;
          try {
            const subAttrs = await client.send(
              new GetSubscriptionAttributesCommand({ SubscriptionArn: sub.SubscriptionArn }),
            );
            const fp = subAttrs.Attributes?.['FilterPolicy'];
            if (fp) {
              const parsed = JSON.parse(fp) as Record<string, unknown>;
              filterPolicies.push({
                subscriptionArn: sub.SubscriptionArn,
                protocol: sub.Protocol ?? 'unknown',
                requiredAttributes: Object.keys(parsed),
                scope: subAttrs.Attributes?.['FilterPolicyScope'] ?? 'MessageAttributes',
              });
            }
          } catch {
            // skip subscription if attributes fetch fails
          }
        }

        topics.push({
          name: arn.split(':').pop() ?? arn,
          arn,
          encrypted: !!attrs['KmsMasterKeyId'],
          subscriptionCount: parseInt(attrs['SubscriptionsConfirmed'] ?? '0', 10),
          subscriptionProtocols: [...new Set(subs.map((s) => s.Protocol ?? 'unknown'))],
          filterPolicies,
        });
      } catch (err) {
        logger.warn(
          `SNS attrs failed for ${arn}: ${err instanceof Error ? err.message : String(err)}`,
        );
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
      const res = await client.send(
        new DescribeParametersCommand({
          NextToken: nextToken,
          MaxResults: 50,
          ParameterFilters: cfg.paths?.length
            ? [{ Key: 'Path', Values: cfg.paths, Option: 'Recursive' }]
            : undefined,
        }),
      );
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

export async function extractSecretsMetadata(
  cfg: AWSConfig = {},
): Promise<SecretsManagerMetadata[]> {
  const client = new SecretsManagerClient(clientConfig(cfg));
  const secrets: SecretsManagerMetadata[] = [];

  try {
    let nextToken: string | undefined;
    do {
      // ListSecrets never returns secret values
      const res = await client.send(
        new ListSecretsCommand({ NextToken: nextToken, MaxResults: 100 }),
      );
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

// ─── IAM ─────────────────────────────────────────────────────────────────────

interface PolicyDoc {
  Statement?: Array<{ Effect?: string; Action?: string | string[] }>;
}

function servicesFromDoc(doc: PolicyDoc): string[] {
  const out = new Set<string>();
  for (const stmt of doc.Statement ?? []) {
    if (stmt.Effect !== 'Allow') continue;
    const actions = Array.isArray(stmt.Action) ? stmt.Action : stmt.Action ? [stmt.Action] : [];
    for (const a of actions) {
      if (a === '*') {
        out.add('*');
        continue;
      }
      const prefix = a.split(':')[0].toLowerCase();
      if (prefix) out.add(prefix);
    }
  }
  return [...out];
}

async function extractAllowedServices(
  roleArn: string,
  cfg: AWSConfig,
): Promise<string[] | undefined> {
  const client = new IAMClient(clientConfig(cfg));
  const roleName = roleArn.split('/').pop()!;
  const services = new Set<string>();

  try {
    let marker: string | undefined;
    do {
      const res = await client.send(
        new ListAttachedRolePoliciesCommand({ RoleName: roleName, Marker: marker }),
      );
      for (const policy of res.AttachedPolicies ?? []) {
        try {
          const meta = await client.send(new GetPolicyCommand({ PolicyArn: policy.PolicyArn }));
          const versionId = meta.Policy?.DefaultVersionId;
          if (!versionId) continue;
          const ver = await client.send(
            new GetPolicyVersionCommand({ PolicyArn: policy.PolicyArn!, VersionId: versionId }),
          );
          const doc = ver.PolicyVersion?.Document;
          if (doc) {
            const parsed = JSON.parse(decodeURIComponent(doc)) as PolicyDoc;
            for (const s of servicesFromDoc(parsed)) services.add(s);
          }
        } catch {
          /* skip unparseable policy */
        }
      }
      marker = res.Marker;
    } while (marker);

    let iMarker: string | undefined;
    do {
      const res = await client.send(
        new ListRolePoliciesCommand({ RoleName: roleName, Marker: iMarker }),
      );
      for (const name of res.PolicyNames ?? []) {
        try {
          const inline = await client.send(
            new GetRolePolicyCommand({ RoleName: roleName, PolicyName: name }),
          );
          if (inline.PolicyDocument) {
            const parsed = JSON.parse(decodeURIComponent(inline.PolicyDocument)) as PolicyDoc;
            for (const s of servicesFromDoc(parsed)) services.add(s);
          }
        } catch {
          /* skip */
        }
      }
      iMarker = res.Marker;
    } while (iMarker);

    return [...services];
  } catch (err) {
    logger.debug(
      `IAM fetch skipped for ${roleName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

// ─── Lambda ───────────────────────────────────────────────────────────────────

const EVENT_SHAPES: Record<string, string> = {
  sqs: 'event.Records[0].body',
  dynamodb: 'event.Records[0].dynamodb.NewImage',
  kinesis: 'event.Records[0].kinesis.data  // base64',
  msk: 'event.records[topic][0].value  // base64',
  sns: 'event.Records[0].Sns.Message',
  s3: 'event.Records[0].s3.object.key',
  eventbridge: 'event.detail',
  unknown: 'event  // unknown trigger type',
};

function triggerFromArn(arn: string, batchSize?: number, state?: string): LambdaTrigger {
  let type: LambdaTrigger['type'] = 'unknown';
  if (arn.includes(':sqs:')) type = 'sqs';
  else if (arn.includes(':dynamodb:')) type = 'dynamodb';
  else if (arn.includes(':kinesis:')) type = 'kinesis';
  else if (arn.includes(':kafka:') || arn.toLowerCase().includes('msk')) type = 'msk';
  else if (arn.includes(':sns:')) type = 'sns';
  else if (arn.includes(':s3:')) type = 's3';

  const sourceName = arn.split(':').pop() ?? arn;
  return { type, sourceArn: arn, sourceName, eventShape: EVENT_SHAPES[type], batchSize, state };
}

async function fetchAllEventSourceMappings(cfg: AWSConfig): Promise<Map<string, LambdaTrigger[]>> {
  const client = new LambdaClient(clientConfig(cfg));
  const triggerMap = new Map<string, LambdaTrigger[]>();

  try {
    let marker: string | undefined;
    do {
      const res = await client.send(
        new ListEventSourceMappingsCommand({ Marker: marker, MaxItems: 100 }),
      );
      for (const m of res.EventSourceMappings ?? []) {
        if (!m.FunctionArn || !m.EventSourceArn) continue;
        const trigger = triggerFromArn(m.EventSourceArn, m.BatchSize, m.State);
        const existing = triggerMap.get(m.FunctionArn) ?? [];
        existing.push(trigger);
        triggerMap.set(m.FunctionArn, existing);
      }
      marker = res.NextMarker;
    } while (marker);
  } catch (err) {
    logger.warn(
      `Event source mappings fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return triggerMap;
}

export async function extractEventBridgeMetadata(
  cfg: AWSConfig = {},
): Promise<EventBridgeRuleMetadata[]> {
  const client = new EventBridgeClient(clientConfig(cfg));
  const rules: EventBridgeRuleMetadata[] = [];

  try {
    let nextToken: string | undefined;
    do {
      const res = await client.send(new ListRulesCommand({ NextToken: nextToken, Limit: 100 }));
      for (const rule of res.Rules ?? []) {
        if (!rule.Name) continue;
        try {
          const targetsRes = await client.send(new ListTargetsByRuleCommand({ Rule: rule.Name }));
          const targetArns = (targetsRes.Targets ?? []).map((t) => t.Arn ?? '').filter(Boolean);
          rules.push({
            name: rule.Name,
            arn: rule.Arn ?? '',
            state: rule.State ?? 'UNKNOWN',
            scheduleExpression: rule.ScheduleExpression,
            eventPattern: rule.EventPattern,
            targetArns,
          });
        } catch (err) {
          logger.warn(
            `EventBridge targets fetch failed for ${rule.Name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      nextToken = res.NextToken;
    } while (nextToken && rules.length < 500);
  } catch (err) {
    logger.warn(`EventBridge list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return rules;
}

export async function validateEventBridgeAccess(cfg: AWSConfig = {}): Promise<void> {
  await new EventBridgeClient(clientConfig(cfg)).send(new ListRulesCommand({ Limit: 1 }));
}

export async function extractLambdaMetadata(
  cfg: AWSConfig = {},
  includeFunctions?: string[],
): Promise<LambdaFunctionMetadata[]> {
  const client = new LambdaClient(clientConfig(cfg));
  const functions: LambdaFunctionMetadata[] = [];

  try {
    let marker: string | undefined;
    do {
      const res = await client.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
      for (const fn of res.Functions ?? []) {
        const name = fn.FunctionName ?? '';
        if (includeFunctions?.length && !includeFunctions.includes(name)) continue;
        functions.push({
          name,
          arn: fn.FunctionArn ?? '',
          runtime: fn.Runtime,
          handler: fn.Handler,
          memoryMB: fn.MemorySize,
          timeoutSec: fn.Timeout,
          lastModified: fn.LastModified,
          envVarKeys: Object.keys(fn.Environment?.Variables ?? {}),
          layers: (fn.Layers ?? []).map((l) => l.Arn ?? '').filter(Boolean),
          triggers: [],
          roleArn: fn.Role,
        });
      }
      marker = res.NextMarker;
    } while (marker);

    // Fetch all event source mappings in one paginated call and attach to functions
    const triggerMap = await fetchAllEventSourceMappings(cfg);
    for (const fn of functions) {
      fn.triggers = triggerMap.get(fn.arn) ?? [];
    }

    // Batch IAM policy fetch per unique role ARN
    const uniqueRoles = [...new Set(functions.map((f) => f.roleArn).filter(Boolean) as string[])];
    const roleServices = new Map<string, string[] | undefined>();
    await Promise.all(
      uniqueRoles.map(async (arn) => {
        roleServices.set(arn, await extractAllowedServices(arn, cfg));
      }),
    );
    for (const fn of functions) {
      if (fn.roleArn) fn.allowedServices = roleServices.get(fn.roleArn);
    }
  } catch (err) {
    logger.warn(`Lambda list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return functions;
}

export async function validateLambdaAccess(cfg: AWSConfig = {}): Promise<void> {
  await new LambdaClient(clientConfig(cfg)).send(new ListFunctionsCommand({ MaxItems: 1 }));
}

// ─── Kinesis ─────────────────────────────────────────────────────────────────

export async function extractKinesisMetadata(
  cfg: AWSConfig = {},
): Promise<KinesisStreamMetadata[]> {
  const client = new KinesisClient(clientConfig(cfg));
  const streams: KinesisStreamMetadata[] = [];

  try {
    let nextToken: string | undefined;
    const names: string[] = [];
    do {
      const res = await client.send(new ListStreamsCommand({ NextToken: nextToken }));
      names.push(...(res.StreamNames ?? []));
      nextToken = res.NextToken;
    } while (nextToken);

    for (const name of names) {
      try {
        const res = await client.send(new DescribeStreamSummaryCommand({ StreamName: name }));
        const d = res.StreamDescriptionSummary;
        if (!d) continue;
        streams.push({
          name,
          arn: d.StreamARN ?? '',
          status: d.StreamStatus ?? 'UNKNOWN',
          shardCount: d.OpenShardCount,
          retentionHours: d.RetentionPeriodHours,
          encrypted: d.EncryptionType === 'KMS',
          mode: d.StreamModeDetails?.StreamMode ?? 'PROVISIONED',
        });
      } catch (err) {
        logger.warn(
          `Kinesis describe failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    logger.warn(`Kinesis list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return streams;
}

// ─── MSK ─────────────────────────────────────────────────────────────────────

export async function extractMSKMetadata(cfg: AWSConfig = {}): Promise<MSKClusterMetadata[]> {
  const client = new KafkaClient(clientConfig(cfg));
  const clusters: MSKClusterMetadata[] = [];

  try {
    let nextToken: string | undefined;
    do {
      const res = await client.send(new ListClustersV2Command({ NextToken: nextToken }));
      for (const c of res.ClusterInfoList ?? []) {
        if (!c.ClusterName) continue;
        clusters.push({
          name: c.ClusterName,
          arn: c.ClusterArn ?? '',
          state: c.State ?? 'UNKNOWN',
          clusterType: c.ClusterType ?? 'PROVISIONED',
          kafkaVersion: c.Provisioned?.CurrentBrokerSoftwareInfo?.KafkaVersion,
          brokerNodes: c.Provisioned?.NumberOfBrokerNodes,
        });
      }
      nextToken = res.NextToken;
    } while (nextToken);
  } catch (err) {
    logger.warn(`MSK list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return clusters;
}

// ─── ElastiCache ─────────────────────────────────────────────────────────────

export async function extractElastiCacheMetadata(
  cfg: AWSConfig = {},
): Promise<ElastiCacheClusterMetadata[]> {
  const client = new ElastiCacheClient(clientConfig(cfg));
  const clusters: ElastiCacheClusterMetadata[] = [];

  try {
    const failoverByGroup = new Map<string, string>();
    try {
      let marker: string | undefined;
      do {
        const res = await client.send(new DescribeReplicationGroupsCommand({ Marker: marker }));
        for (const g of res.ReplicationGroups ?? []) {
          if (g.ReplicationGroupId) {
            failoverByGroup.set(g.ReplicationGroupId, g.AutomaticFailover ?? 'disabled');
          }
        }
        marker = res.Marker;
      } while (marker);
    } catch {
      /* replication groups are optional context */
    }

    let marker: string | undefined;
    do {
      const res = await client.send(new DescribeCacheClustersCommand({ Marker: marker }));
      for (const c of res.CacheClusters ?? []) {
        if (!c.CacheClusterId) continue;
        clusters.push({
          id: c.CacheClusterId,
          engine: c.Engine ?? 'unknown',
          engineVersion: c.EngineVersion ?? '',
          nodeType: c.CacheNodeType ?? '',
          numNodes: c.NumCacheNodes ?? 0,
          transitEncryption: c.TransitEncryptionEnabled ?? false,
          atRestEncryption: c.AtRestEncryptionEnabled ?? false,
          replicationGroupId: c.ReplicationGroupId,
          automaticFailover: c.ReplicationGroupId
            ? failoverByGroup.get(c.ReplicationGroupId)
            : undefined,
        });
      }
      marker = res.Marker;
    } while (marker);
  } catch (err) {
    logger.warn(`ElastiCache list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return clusters;
}

// ─── Cognito ─────────────────────────────────────────────────────────────────

export async function extractCognitoMetadata(
  cfg: AWSConfig = {},
): Promise<CognitoUserPoolMetadata[]> {
  const client = new CognitoIdentityProviderClient(clientConfig(cfg));
  const pools: CognitoUserPoolMetadata[] = [];

  try {
    let nextToken: string | undefined;
    const poolRefs: Array<{ id: string; name: string }> = [];
    do {
      const res = await client.send(
        new ListUserPoolsCommand({ MaxResults: 60, NextToken: nextToken }),
      );
      for (const p of res.UserPools ?? []) {
        if (p.Id && p.Name) poolRefs.push({ id: p.Id, name: p.Name });
      }
      nextToken = res.NextToken;
    } while (nextToken);

    for (const ref of poolRefs) {
      try {
        const poolRes = await client.send(new DescribeUserPoolCommand({ UserPoolId: ref.id }));
        const clients: CognitoAppClientMetadata[] = [];
        let clientToken: string | undefined;
        do {
          const clientsRes = await client.send(
            new ListUserPoolClientsCommand({
              UserPoolId: ref.id,
              MaxResults: 60,
              NextToken: clientToken,
            }),
          );
          for (const c of clientsRes.UserPoolClients ?? []) {
            if (!c.ClientId) continue;
            try {
              const detail = await client.send(
                new DescribeUserPoolClientCommand({ UserPoolId: ref.id, ClientId: c.ClientId }),
              );
              const d = detail.UserPoolClient;
              if (!d) continue;
              clients.push({
                clientName: d.ClientName ?? c.ClientName ?? '',
                clientId: c.ClientId,
                authFlows: d.ExplicitAuthFlows ?? [],
                oauthFlows: d.AllowedOAuthFlows ?? [],
                oauthScopes: d.AllowedOAuthScopes ?? [],
                callbackUrls: d.CallbackURLs ?? [],
                generatesSecret: !!d.ClientSecret,
                accessTokenValidity: d.AccessTokenValidity,
                idTokenValidity: d.IdTokenValidity,
                refreshTokenValidity: d.RefreshTokenValidity,
                tokenValidityUnits: d.TokenValidityUnits
                  ? {
                      accessToken: d.TokenValidityUnits.AccessToken,
                      idToken: d.TokenValidityUnits.IdToken,
                      refreshToken: d.TokenValidityUnits.RefreshToken,
                    }
                  : undefined,
              });
            } catch {
              /* skip client on describe failure */
            }
          }
          clientToken = clientsRes.NextToken;
        } while (clientToken);

        pools.push({
          name: ref.name,
          id: ref.id,
          mfaConfiguration: poolRes.UserPool?.MfaConfiguration,
          clients,
        });
      } catch (err) {
        logger.warn(
          `Cognito describe failed for ${ref.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    logger.warn(`Cognito list failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return pools;
}

// ─── RDS ─────────────────────────────────────────────────────────────────────

export async function extractRDSMetadata(cfg: AWSConfig = {}): Promise<RDSInstanceMetadata[]> {
  const client = new RDSClient(clientConfig(cfg));
  const instances: RDSInstanceMetadata[] = [];

  try {
    let marker: string | undefined;
    do {
      const res = await client.send(
        new DescribeDBInstancesCommand({ Marker: marker, MaxRecords: 100 }),
      );
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

// ─── API Gateway ──────────────────────────────────────────────────────────────

function lambdaNameFromArn(arn?: string): string | undefined {
  if (!arn) return undefined;
  const parts = arn.split(':');
  return parts[parts.length - 1] || undefined;
}

export async function extractAPIGatewayMetadata(
  cfg: AWSConfig = {},
): Promise<APIGatewayMetadata[]> {
  const results: APIGatewayMetadata[] = [];
  const ccfg = clientConfig(cfg);

  // REST APIs (v1)
  try {
    const restClient = new APIGatewayClient(ccfg);
    let position: string | undefined;
    const restApis: Array<{ id: string; name: string }> = [];
    do {
      const res = await restClient.send(new GetRestApisCommand({ position, limit: 500 }));
      for (const api of res.items ?? []) {
        if (api.id && api.name) restApis.push({ id: api.id, name: api.name });
      }
      position = res.position;
    } while (position);

    for (const api of restApis) {
      const routes: APIGatewayRouteMetadata[] = [];
      try {
        const resourcesRes = await restClient.send(
          new GetResourcesCommand({ restApiId: api.id, embed: ['methods'], limit: 500 }),
        );
        for (const resource of resourcesRes.items ?? []) {
          const resourcePath = resource.path ?? '/';
          for (const [method, methodItem] of Object.entries(resource.resourceMethods ?? {})) {
            if (method === 'OPTIONS') continue;
            const integration = (methodItem as Record<string, Record<string, unknown> | undefined>)
              ?.methodIntegration;
            const lambdaArn = typeof integration?.uri === 'string' ? integration.uri : undefined;
            const lambdaName = lambdaArn
              ? lambdaNameFromArn(lambdaArn.split('/functions/')[1]?.split('/')[0])
              : undefined;
            routes.push({ method, path: resourcePath, lambdaArn, lambdaName });
          }
        }
      } catch (err) {
        logger.warn(
          `API Gateway REST resources failed for ${api.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      results.push({ name: api.name, id: api.id, type: 'REST', routes });
    }
  } catch (err) {
    logger.warn(
      `API Gateway REST list failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // HTTP + WebSocket APIs (v2)
  try {
    const v2Client = new ApiGatewayV2Client(ccfg);
    let nextToken: string | undefined;
    const v2Apis: Array<{ id: string; name: string; protocolType: string }> = [];
    do {
      const res = await v2Client.send(
        new GetApisCommand({ NextToken: nextToken, MaxResults: '500' }),
      );
      for (const api of res.Items ?? []) {
        if (api.ApiId && api.Name) {
          v2Apis.push({ id: api.ApiId, name: api.Name, protocolType: api.ProtocolType ?? 'HTTP' });
        }
      }
      nextToken = res.NextToken;
    } while (nextToken);

    for (const api of v2Apis) {
      const apiType = api.protocolType === 'WEBSOCKET' ? 'WEBSOCKET' : 'HTTP';
      const routes: APIGatewayRouteMetadata[] = [];

      try {
        const [routesRes, integrationsRes] = await Promise.all([
          v2Client.send(new GetRoutesCommand({ ApiId: api.id, MaxResults: '500' })),
          v2Client.send(new GetIntegrationsCommand({ ApiId: api.id, MaxResults: '500' })),
        ]);

        const integrationMap = new Map<string, string>();
        for (const integ of integrationsRes.Items ?? []) {
          if (integ.IntegrationId && integ.IntegrationUri) {
            integrationMap.set(integ.IntegrationId, integ.IntegrationUri);
          }
        }

        for (const route of routesRes.Items ?? []) {
          const routeKey = route.RouteKey ?? '';
          const [method, ...pathParts] = routeKey.split(' ');
          const routePath = pathParts.join(' ') || '/';
          const integrationId = route.Target?.replace('integrations/', '');
          const lambdaArn = integrationId ? integrationMap.get(integrationId) : undefined;
          const lambdaName = lambdaArn
            ? lambdaNameFromArn(lambdaArn.split('/functions/')[1]?.split('/')[0])
            : undefined;
          routes.push({ method: method ?? routeKey, path: routePath, lambdaArn, lambdaName });
        }
      } catch (err) {
        logger.warn(
          `API Gateway v2 routes failed for ${api.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      results.push({ name: api.name, id: api.id, type: apiType, routes });
    }
  } catch (err) {
    logger.debug(`API Gateway v2 list failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return results;
}
