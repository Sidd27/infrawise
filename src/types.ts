export type GraphNode =
  | {
      id: string;
      type: 'table';
      name: string;
      databaseType: 'dynamodb' | 'postgres' | 'mysql' | 'mongodb';
    }
  | { id: string; type: 'function'; name: string; file: string }
  | { id: string; type: 'index'; name: string }
  | { id: string; type: 'query'; operation: string }
  | {
      id: string;
      type: 'queue';
      name: string;
      provider: string;
      hasDLQ: boolean;
      encrypted: boolean;
      isFifo?: boolean;
      visibilityTimeoutSec?: number;
      approximateMessages?: number;
      retentionDays?: number;
    }
  | {
      id: string;
      type: 'topic';
      name: string;
      provider: string;
      subscriptionCount?: number;
      encrypted: boolean;
      filterPolicies?: Array<{
        subscriptionArn: string;
        protocol: string;
        requiredAttributes: string[];
        scope: string;
      }>;
    }
  | {
      id: string;
      type: 'secret';
      name: string;
      provider: string;
      rotationEnabled: boolean;
      rotationDays?: number;
    }
  | {
      id: string;
      type: 'parameter';
      name: string;
      provider: string;
      paramType: string;
      tier: string;
    }
  | {
      id: string;
      type: 'log_group';
      name: string;
      provider: string;
      retentionDays?: number;
      errorCount?: number;
      topErrorPatterns?: Array<{ pattern: string; count: number }>;
    }
  | {
      id: string;
      type: 'bucket';
      name: string;
      provider: string;
      versioned?: boolean;
      encrypted?: boolean;
      publicAccessBlocked?: boolean | null;
    }
  | {
      id: string;
      type: 'lambda';
      name: string;
      runtime?: string;
      memoryMB?: number;
      timeoutSec?: number;
      envVarKeys?: string[];
      triggers?: LambdaTrigger[];
      roleArn?: string;
      allowedServices?: string[];
    }
  | {
      id: string;
      type: 'eventbridge_rule';
      name: string;
      state: string;
      scheduleExpression?: string;
      eventPattern?: string;
    }
  | {
      id: string;
      type: 'api';
      name: string;
      provider: string;
      apiType?: 'REST' | 'HTTP' | 'WEBSOCKET';
      stageName?: string;
      routes?: APIGatewayRouteMetadata[];
    }
  | {
      id: string;
      type: 'database_instance';
      name: string;
      provider: string;
      engine: string;
      engineVersion: string;
      instanceClass: string;
      publiclyAccessible: boolean;
      storageEncrypted: boolean;
      backupRetentionDays: number;
      deletionProtection: boolean;
      multiAZ: boolean;
    };

export type GraphEdge =
  | { from: string; to: string; type: 'query' }
  | { from: string; to: string; type: 'scan' }
  | { from: string; to: string; type: 'joins' }
  | { from: string; to: string; type: 'uses_index' }
  | { from: string; to: string; type: 'publishes_to' }
  | { from: string; to: string; type: 'subscribes_to' }
  | { from: string; to: string; type: 'reads_secret' }
  | { from: string; to: string; type: 'reads_parameter' }
  | { from: string; to: string; type: 'triggers' };

export interface SystemGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Database metadata ───────────────────────────────────────────────────────

export interface DynamoTableMetadata {
  tableName: string;
  partitionKey?: string;
  sortKey?: string;
  indexes: string[];
}

export interface PostgresTableMetadata {
  schema: string;
  table: string;
  columns: string[];
  indexes: string[];
  primaryKeys: string[];
}

export interface MySQLTableMetadata {
  schema: string;
  table: string;
  columns: string[];
  indexes: string[];
  primaryKeys: string[];
  engine: string;
}

export interface MongoIndexMetadata {
  name: string;
  keys: Record<string, unknown>;
  unique: boolean;
  sparse: boolean;
}

export interface MongoCollectionMetadata {
  database: string;
  collection: string;
  indexes: MongoIndexMetadata[];
  estimatedCount: number;
}

// ─── AWS service metadata ────────────────────────────────────────────────────

export interface SQSQueueMetadata {
  name: string;
  url: string;
  arn: string;
  hasDLQ: boolean;
  dlqArn?: string;
  encrypted: boolean;
  isFifo: boolean;
  visibilityTimeoutSec: number;
  retentionDays: number;
  approximateMessages: number;
  approximateInflight: number;
}

export interface APIGatewayRouteMetadata {
  method: string;
  path: string;
  lambdaArn?: string;
  lambdaName?: string;
}

export interface APIGatewayMetadata {
  name: string;
  id: string;
  type: 'REST' | 'HTTP' | 'WEBSOCKET';
  stageName?: string;
  routes: APIGatewayRouteMetadata[];
}

export interface SNSFilterPolicy {
  subscriptionArn: string;
  protocol: string;
  requiredAttributes: string[];
  scope: string;
}

export interface SNSTopicMetadata {
  name: string;
  arn: string;
  encrypted: boolean;
  subscriptionCount: number;
  subscriptionProtocols: string[];
  filterPolicies: SNSFilterPolicy[];
}

export interface SSMParameterMetadata {
  name: string;
  type: string;
  tier: string;
  lastModified?: string;
  description?: string;
  keyId?: string;
  // Value is NEVER included
}

export interface SecretsManagerMetadata {
  name: string;
  arn: string;
  rotationEnabled: boolean;
  rotationDays?: number;
  lastRotated?: string;
  lastAccessed?: string;
  description?: string;
  // Secret value is NEVER included
}

export interface LambdaTrigger {
  type: 'sqs' | 'dynamodb' | 'kinesis' | 'msk' | 'eventbridge' | 'sns' | 's3' | 'unknown';
  sourceArn: string;
  sourceName: string;
  eventShape: string;
  batchSize?: number;
  state?: string;
  events?: string[];
  // eventbridge only
  ruleName?: string;
  eventPattern?: string;
}

export interface LambdaFunctionMetadata {
  name: string;
  arn: string;
  runtime?: string;
  handler?: string;
  memoryMB?: number;
  timeoutSec?: number;
  lastModified?: string;
  envVarKeys: string[]; // Key names only — values are never included
  layers: string[];
  triggers: LambdaTrigger[];
  roleArn?: string;
  allowedServices?: string[]; // service prefixes the execution role allows, e.g. ['dynamodb', 's3']
}

export interface LogGroupSummary {
  logGroupName: string;
  retentionDays?: number; // undefined = never expires
  errorCount: number;
  warnCount: number;
  topErrorPatterns: Array<{ pattern: string; count: number }>;
  lastErrorTime?: string;
}

export interface EventBridgeRuleMetadata {
  name: string;
  arn: string;
  state: string;
  scheduleExpression?: string;
  eventPattern?: string;
  targetArns: string[];
}

export interface RDSInstanceMetadata {
  dbInstanceIdentifier: string;
  engine: string;
  engineVersion: string;
  instanceClass: string;
  publiclyAccessible: boolean;
  storageEncrypted: boolean;
  backupRetentionDays: number;
  deletionProtection: boolean;
  multiAZ: boolean;
  dbInstanceStatus: string;
}

export interface S3EventNotification {
  events: string[];
  lambdaArn: string;
  lambdaName: string;
  prefix?: string;
  suffix?: string;
}

export interface S3BucketMetadata {
  name: string;
  arn: string;
  createdAt?: string;
  versioned: boolean;
  encrypted: boolean;
  publicAccessBlocked: boolean | null;
  notifications: S3EventNotification[];
}

// Aggregated services metadata passed to graph builder
export interface ServicesMeta {
  sqs?: SQSQueueMetadata[];
  sns?: SNSTopicMetadata[];
  ssm?: SSMParameterMetadata[];
  secrets?: SecretsManagerMetadata[];
  lambda?: LambdaFunctionMetadata[];
  eventbridge?: EventBridgeRuleMetadata[];
  logs?: LogGroupSummary[];
  rds?: RDSInstanceMetadata[];
  s3?: S3BucketMetadata[];
  apiGateway?: APIGatewayMetadata[];
}

// ─── Operations ─────────────────────────────────────────────────────────────

export interface ExtractedOperation {
  functionName: string;
  operationType: string;
  serviceType:
    | 'dynamodb'
    | 'postgres'
    | 'mysql'
    | 'mongodb'
    | 'sqs'
    | 'sns'
    | 'ssm'
    | 'secretsmanager'
    | 'lambda'
    | 'kafka';
  target: string;
  filePath: string;
}

// ─── Analysis ───────────────────────────────────────────────────────────────

export interface Finding {
  severity: 'low' | 'medium' | 'high' | 'verify';
  issue: string;
  description: string;
  recommendation: string;
  metadata?: Record<string, unknown>;
}

export interface Analyzer {
  name: string;
  analyze(graph: SystemGraph): Promise<Finding[]>;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface InfrawiseConfig {
  project: string;
  aws?: {
    profile?: string;
    region?: string;
  };
  dynamodb?: {
    enabled?: boolean;
    includeTables?: string[];
  };
  postgres?: {
    enabled?: boolean;
    connectionString?: string;
  };
  mysql?: {
    enabled?: boolean;
    connectionString?: string;
  };
  mongodb?: {
    enabled?: boolean;
    connectionString?: string;
    databases?: string[];
  };
  terraform?: {
    enabled?: boolean;
  };
  sqs?: {
    enabled?: boolean;
  };
  sns?: {
    enabled?: boolean;
  };
  ssm?: {
    enabled?: boolean;
    paths?: string[];
  };
  secretsManager?: {
    enabled?: boolean;
  };
  lambda?: {
    enabled?: boolean;
    includeFunctions?: string[];
  };
  eventbridge?: {
    enabled?: boolean;
  };
  rds?: {
    enabled?: boolean;
  };
  s3?: {
    enabled?: boolean;
  };
  apiGateway?: {
    enabled?: boolean;
  };
  cloudwatchLogs?: {
    enabled?: boolean;
    logGroupPrefixes?: string[];
    windowHours?: number;
  };
  analysis?: {
    sampleSize?: number;
    hotPartitionThreshold?: number;
    hotPartitionThresholds?: Record<string, number>;
  };
}

// ─── Cache ───────────────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  timestamp: number;
  data: T;
  version: string;
}
