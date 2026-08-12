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
  GetFunctionConcurrencyCommand,
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
  CloudFrontClient,
  ListDistributionsCommand,
  ListCachePoliciesCommand,
} from '@aws-sdk/client-cloudfront';
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
  CloudFrontDistributionMetadata,
  CloudFrontOriginMetadata,
  CloudFrontBehaviorMetadata,
} from '../../types.js';
import { logger, PartialExtractionError } from '../../core/index.js';

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
  return queues;
}

export async function validateSQSAccess(cfg: AWSConfig = {}): Promise<void> {
  await new SQSClient(clientConfig(cfg)).send(new ListQueuesCommand({ MaxResults: 1 }));
}

// ─── SNS ─────────────────────────────────────────────────────────────────────

export async function extractSNSMetadata(cfg: AWSConfig = {}): Promise<SNSTopicMetadata[]> {
  const client = new SNSClient(clientConfig(cfg));
  const topics: SNSTopicMetadata[] = [];

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
  return secrets;
}

export async function validateSecretsAccess(cfg: AWSConfig = {}): Promise<void> {
  await new SecretsManagerClient(clientConfig(cfg)).send(new ListSecretsCommand({ MaxResults: 1 }));
}

// ─── IAM ─────────────────────────────────────────────────────────────────────

interface PolicyDoc {
  Statement?: Array<{ Effect?: string; Action?: string | string[] }>;
}

// An explicit Deny always beats an Allow in IAM evaluation, so a service named
// in both is not permitted. Reading only Allow reported the one case where the
// call is guaranteed to fail at runtime as permitted.
function servicesFromDoc(doc: PolicyDoc): { allowed: string[]; denied: string[] } {
  const allowed = new Set<string>();
  const denied = new Set<string>();
  for (const stmt of doc.Statement ?? []) {
    if (stmt.Effect !== 'Allow' && stmt.Effect !== 'Deny') continue;
    const into = stmt.Effect === 'Allow' ? allowed : denied;
    const actions = Array.isArray(stmt.Action) ? stmt.Action : stmt.Action ? [stmt.Action] : [];
    for (const a of actions) {
      if (a === '*') {
        into.add('*');
        continue;
      }
      const prefix = a.split(':')[0].toLowerCase();
      if (prefix) into.add(prefix);
    }
  }
  return { allowed: [...allowed], denied: [...denied] };
}

async function extractAllowedServices(
  roleArn: string,
  cfg: AWSConfig,
): Promise<string[] | undefined> {
  const client = new IAMClient(clientConfig(cfg));
  const roleName = roleArn.split('/').pop() ?? roleArn;
  const services = new Set<string>();
  const denies = new Set<string>();

  try {
    let marker: string | undefined;
    do {
      const res = await client.send(
        new ListAttachedRolePoliciesCommand({ RoleName: roleName, Marker: marker }),
      );
      for (const policy of res.AttachedPolicies ?? []) {
        if (!policy.PolicyArn) continue;
        try {
          const meta = await client.send(new GetPolicyCommand({ PolicyArn: policy.PolicyArn }));
          const versionId = meta.Policy?.DefaultVersionId;
          if (!versionId) continue;
          const ver = await client.send(
            new GetPolicyVersionCommand({ PolicyArn: policy.PolicyArn, VersionId: versionId }),
          );
          const doc = ver.PolicyVersion?.Document;
          if (doc) {
            const parsed = JSON.parse(decodeURIComponent(doc)) as PolicyDoc;
            const { allowed, denied } = servicesFromDoc(parsed);
            for (const s of allowed) services.add(s);
            for (const s of denied) denies.add(s);
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
            const { allowed, denied } = servicesFromDoc(parsed);
            for (const s of allowed) services.add(s);
            for (const s of denied) denies.add(s);
          }
        } catch {
          /* skip */
        }
      }
      iMarker = res.Marker;
    } while (iMarker);

    return [...services].filter((s) => !denies.has(s) && !denies.has('*'));
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

function triggerFromArn(
  arn: string,
  batchSize?: number,
  state?: string,
  reportsBatchItemFailures?: boolean,
): LambdaTrigger {
  let type: LambdaTrigger['type'] = 'unknown';
  if (arn.includes(':sqs:')) type = 'sqs';
  else if (arn.includes(':dynamodb:')) type = 'dynamodb';
  else if (arn.includes(':kinesis:')) type = 'kinesis';
  else if (arn.includes(':kafka:') || arn.toLowerCase().includes('msk')) type = 'msk';
  else if (arn.includes(':sns:')) type = 'sns';
  else if (arn.includes(':s3:')) type = 's3';

  const sourceName = arn.split(':').pop() ?? arn;
  return {
    type,
    sourceArn: arn,
    sourceName,
    eventShape: EVENT_SHAPES[type],
    batchSize,
    state,
    reportsBatchItemFailures,
  };
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
        // FunctionResponseTypes rides this same response — no extra call needed.
        const trigger = triggerFromArn(
          m.EventSourceArn,
          m.BatchSize,
          m.State,
          (m.FunctionResponseTypes ?? []).includes('ReportBatchItemFailures'),
        );
        const existing = triggerMap.get(m.FunctionArn) ?? [];
        existing.push(trigger);
        triggerMap.set(m.FunctionArn, existing);
      }
      marker = res.NextMarker;
    } while (marker);
  } catch (err) {
    // Keep whatever mappings were paginated before the failure, but say so:
    // an empty triggers array otherwise reads as "this Lambda has no trigger".
    throw new PartialExtractionError(
      `event source mappings incomplete: ${err instanceof Error ? err.message : String(err)}`,
      triggerMap,
    );
  }
  return triggerMap;
}

export async function extractEventBridgeMetadata(
  cfg: AWSConfig = {},
): Promise<EventBridgeRuleMetadata[]> {
  const client = new EventBridgeClient(clientConfig(cfg));
  const rules: EventBridgeRuleMetadata[] = [];

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
  let triggersIncomplete: string | undefined;
  let triggerMap: Map<string, LambdaTrigger[]>;
  try {
    triggerMap = await fetchAllEventSourceMappings(cfg);
  } catch (err) {
    if (!(err instanceof PartialExtractionError)) throw err;
    triggerMap = err.data as Map<string, LambdaTrigger[]>;
    triggersIncomplete = err.message;
  }
  for (const fn of functions) {
    fn.triggers = triggerMap.get(fn.arn) ?? [];
  }

  // Reserved concurrency, only for functions on a poll-based trigger. This is one
  // call per function, so it is scoped to the ones where unbounded scaling
  // actually matters: a queue or stream can hand a function more work than the
  // account (or the database behind it) can absorb. An API-triggered function
  // does not have that shape, and is not worth an extra API call per analyze.
  const POLL_TRIGGERS = new Set(['sqs', 'kinesis', 'dynamodb', 'msk']);
  const polled = functions.filter((f) => f.triggers.some((t) => POLL_TRIGGERS.has(t.type)));
  await Promise.all(
    polled.map(async (fn) => {
      try {
        const res = await client.send(new GetFunctionConcurrencyCommand({ FunctionName: fn.name }));
        // Absent in the response means no reservation is configured, which is a
        // real answer. Leaving it undefined would say "never looked".
        fn.reservedConcurrency = res.ReservedConcurrentExecutions ?? null;
      } catch (err) {
        logger.debug(
          `Reserved concurrency unavailable for ${fn.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

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

  if (triggersIncomplete) throw new PartialExtractionError(triggersIncomplete, functions);
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
  return streams;
}

// ─── MSK ─────────────────────────────────────────────────────────────────────

export async function extractMSKMetadata(cfg: AWSConfig = {}): Promise<MSKClusterMetadata[]> {
  const client = new KafkaClient(clientConfig(cfg));
  const clusters: MSKClusterMetadata[] = [];

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
  return clusters;
}

// ─── ElastiCache ─────────────────────────────────────────────────────────────

export async function extractElastiCacheMetadata(
  cfg: AWSConfig = {},
): Promise<ElastiCacheClusterMetadata[]> {
  const client = new ElastiCacheClient(clientConfig(cfg));
  const clusters: ElastiCacheClusterMetadata[] = [];

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
  return clusters;
}

// ─── Cognito ─────────────────────────────────────────────────────────────────

export async function extractCognitoMetadata(
  cfg: AWSConfig = {},
): Promise<CognitoUserPoolMetadata[]> {
  const client = new CognitoIdentityProviderClient(clientConfig(cfg));
  const pools: CognitoUserPoolMetadata[] = [];

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
  return pools;
}

// ─── RDS ─────────────────────────────────────────────────────────────────────

export async function extractRDSMetadata(cfg: AWSConfig = {}): Promise<RDSInstanceMetadata[]> {
  const client = new RDSClient(clientConfig(cfg));
  const instances: RDSInstanceMetadata[] = [];

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
  return instances;
}

export async function validateRDSAccess(cfg: AWSConfig = {}): Promise<void> {
  await new RDSClient(clientConfig(cfg)).send(new DescribeDBInstancesCommand({ MaxRecords: 20 }));
}

// ─── CloudFront ──────────────────────────────────────────────────────────────

// Cache policies are referenced by opaque UUID. Resolving the ids to names is
// what makes the behavior readable ("CachingDisabled" vs a uuid).
async function cachePolicyNames(client: CloudFrontClient): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const type of ['managed', 'custom'] as const) {
    try {
      const res = await client.send(new ListCachePoliciesCommand({ Type: type }));
      for (const item of res.CachePolicyList?.Items ?? []) {
        const id = item.CachePolicy?.Id;
        const name = item.CachePolicy?.CachePolicyConfig?.Name;
        if (id && name) names.set(id, name);
      }
    } catch {
      /* policy names are optional context */
    }
  }
  return names;
}

export async function extractCloudFrontMetadata(
  cfg: AWSConfig = {},
): Promise<CloudFrontDistributionMetadata[]> {
  // CloudFront is a global service — its control plane only answers in us-east-1.
  const client = new CloudFrontClient({ ...clientConfig(cfg), region: 'us-east-1' });
  const distributions: CloudFrontDistributionMetadata[] = [];

  const policyNames = await cachePolicyNames(client);

  let marker: string | undefined;
  do {
    const res = await client.send(new ListDistributionsCommand({ Marker: marker }));
    for (const d of res.DistributionList?.Items ?? []) {
      if (!d.Id) continue;

      const origins: CloudFrontOriginMetadata[] = (d.Origins?.Items ?? []).map((o) => ({
        id: o.Id ?? '',
        domainName: o.DomainName ?? '',
        originType: o.S3OriginConfig ? 's3' : 'custom',
        originPath: o.OriginPath || undefined,
      }));

      const toBehavior = (
        b: {
          PathPattern?: string;
          TargetOriginId?: string;
          ViewerProtocolPolicy?: string;
          CachePolicyId?: string;
          AllowedMethods?: { Items?: string[] };
        },
        isDefault: boolean,
      ): CloudFrontBehaviorMetadata => ({
        pathPattern: isDefault ? '*' : (b.PathPattern ?? '*'),
        targetOriginId: b.TargetOriginId ?? '',
        viewerProtocolPolicy: b.ViewerProtocolPolicy ?? 'unknown',
        cachePolicy: b.CachePolicyId
          ? (policyNames.get(b.CachePolicyId) ?? b.CachePolicyId)
          : undefined,
        allowedMethods: b.AllowedMethods?.Items,
        isDefault,
      });

      // Ordered cache behaviors are matched first, in order; the default
      // behavior is the fallback, so it belongs last.
      const behaviors = [
        ...(d.CacheBehaviors?.Items ?? []).map((b) => toBehavior(b, false)),
        ...(d.DefaultCacheBehavior ? [toBehavior(d.DefaultCacheBehavior, true)] : []),
      ];

      distributions.push({
        id: d.Id,
        domainName: d.DomainName ?? '',
        comment: d.Comment || undefined,
        enabled: d.Enabled ?? false,
        aliases: d.Aliases?.Items ?? [],
        origins,
        behaviors,
      });
    }
    marker = res.DistributionList?.IsTruncated ? res.DistributionList.NextMarker : undefined;
  } while (marker);

  logger.debug(`Extracted ${distributions.length} CloudFront distribution(s)`);

  return distributions;
}

// ─── API Gateway ──────────────────────────────────────────────────────────────

// An integration URI is either the API Gateway invoke path
// (arn:aws:apigateway:<region>:lambda:path/2015-03-31/functions/<fnArn>/invocations)
// or, for HTTP API AWS_PROXY integrations, the bare function ARN. Both forms put
// the name after "function:", optionally followed by an alias or version
// qualifier. Non-Lambda integrations (HTTP proxy, S3, Step Functions) have no
// "function:" segment and correctly resolve to undefined.
export function lambdaNameFromIntegrationUri(uri?: string): string | undefined {
  if (!uri) return undefined;
  return /:function:([^:/]+)/.exec(uri)?.[1];
}

export async function extractAPIGatewayMetadata(
  cfg: AWSConfig = {},
): Promise<APIGatewayMetadata[]> {
  const results: APIGatewayMetadata[] = [];
  let restFailed: unknown;
  let v2Failed: unknown;
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
            const lambdaName = lambdaNameFromIntegrationUri(lambdaArn);
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
    restFailed = err;
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
          const lambdaName = lambdaNameFromIntegrationUri(lambdaArn);
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
    v2Failed = err;
    logger.debug(`API Gateway v2 list failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // REST and v2 are independent APIs — one failing still leaves real data from
  // the other, so only a total miss is reported as unread. Half-read results
  // stay available rather than being thrown away.
  if (restFailed && v2Failed) throw restFailed;

  return results;
}
