export type GraphNode =
  | { id: string; type: 'table'; name: string; databaseType: 'dynamodb' | 'postgres' | 'mysql' | 'mongodb' }
  | { id: string; type: 'function'; name: string; file: string }
  | { id: string; type: 'index'; name: string }
  | { id: string; type: 'query'; operation: string }
  | {
      id: string; type: 'queue'; name: string; provider: string;
      hasDLQ: boolean; encrypted: boolean;
      approximateMessages?: number; retentionDays?: number;
    }
  | { id: string; type: 'topic'; name: string; provider: string; subscriptionCount?: number; encrypted: boolean }
  | { id: string; type: 'secret'; name: string; provider: string; rotationEnabled: boolean; rotationDays?: number }
  | { id: string; type: 'parameter'; name: string; provider: string; paramType: string; tier: string }
  | {
      id: string; type: 'log_group'; name: string; provider: string;
      retentionDays?: number; errorCount?: number;
      topErrorPatterns?: Array<{ pattern: string; count: number }>;
    }
  | { id: string; type: 'bucket'; name: string; provider: string; versioned?: boolean }
  | { id: string; type: 'lambda'; name: string; runtime?: string; memoryMB?: number; timeoutSec?: number; envVarKeys?: string[] }
  | { id: string; type: 'api'; name: string; provider: string; stageName?: string };

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
  visibilityTimeoutSec: number;
  retentionDays: number;
  approximateMessages: number;
  approximateInflight: number;
}

export interface SNSTopicMetadata {
  name: string;
  arn: string;
  encrypted: boolean;
  subscriptionCount: number;
  subscriptionProtocols: string[];
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

export interface LambdaFunctionMetadata {
  name: string;
  arn: string;
  runtime?: string;
  handler?: string;
  memoryMB?: number;
  timeoutSec?: number;
  lastModified?: string;
  envVarKeys: string[];  // Key names only — values are never included
  layers: string[];
}

export interface LogGroupSummary {
  logGroupName: string;
  retentionDays?: number;  // undefined = never expires
  errorCount: number;
  warnCount: number;
  topErrorPatterns: Array<{ pattern: string; count: number }>;
  lastErrorTime?: string;
}

// Aggregated services metadata passed to graph builder
export interface ServicesMeta {
  sqs?: SQSQueueMetadata[];
  sns?: SNSTopicMetadata[];
  ssm?: SSMParameterMetadata[];
  secrets?: SecretsManagerMetadata[];
  lambda?: LambdaFunctionMetadata[];
  logs?: LogGroupSummary[];
}

// ─── Operations ─────────────────────────────────────────────────────────────

export interface ExtractedOperation {
  functionName: string;
  operationType: string;
  databaseType: 'dynamodb' | 'postgres' | 'mysql' | 'mongodb' | 'sqs' | 'sns' | 'ssm' | 'secretsmanager' | 'lambda';
  target: string;
  filePath: string;
}

// ─── Analysis ───────────────────────────────────────────────────────────────

export interface Finding {
  severity: 'low' | 'medium' | 'high';
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
  };
  cloudwatchLogs?: {
    enabled?: boolean;
    logGroupPrefixes?: string[];
    windowHours?: number;
  };
  analysis?: {
    sampleSize?: number;
  };
}

// ─── MCP ────────────────────────────────────────────────────────────────────

export interface MCPToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  timestamp: number;
  data: T;
  version: string;
}
