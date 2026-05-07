export type GraphNode =
  | { id: string; type: 'table'; name: string; databaseType: 'dynamodb' | 'postgres' | 'mysql' | 'mongodb' }
  | { id: string; type: 'function'; name: string; file: string }
  | { id: string; type: 'index'; name: string }
  | { id: string; type: 'query'; operation: string };

export type GraphEdge =
  | { from: string; to: string; type: 'query' }
  | { from: string; to: string; type: 'scan' }
  | { from: string; to: string; type: 'joins' }
  | { from: string; to: string; type: 'uses_index' };

export interface SystemGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

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

export interface ExtractedOperation {
  functionName: string;
  operationType: string;
  databaseType: 'dynamodb' | 'postgres' | 'mysql' | 'mongodb';
  target: string;
  filePath: string;
}

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
  analysis?: {
    sampleSize?: number;
  };
}

export interface MCPToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface CacheEntry<T> {
  timestamp: number;
  data: T;
  version: string;
}
