import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import type { DynamoTableMetadata, InfrawiseConfig } from '../../types.js';
import { DynamoDBError, logger } from '../../core/index.js';

function createDynamoClient(config: InfrawiseConfig): DynamoDBClient {
  const region = config.aws?.region ?? 'us-east-1';
  const profile = config.aws?.profile;

  const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = { region };

  if (profile) clientConfig.credentials = fromIni({ profile });

  return new DynamoDBClient(clientConfig);
}

function parseTableDescription(desc: TableDescription): DynamoTableMetadata {
  const tableName = desc.TableName ?? 'unknown';

  const partitionKey = desc.KeySchema?.find((k) => k.KeyType === 'HASH')?.AttributeName;
  const sortKey = desc.KeySchema?.find((k) => k.KeyType === 'RANGE')?.AttributeName;

  const indexes: string[] = [];

  // Global secondary indexes
  if (desc.GlobalSecondaryIndexes) {
    for (const gsi of desc.GlobalSecondaryIndexes) {
      if (gsi.IndexName) indexes.push(gsi.IndexName);
    }
  }

  // Local secondary indexes
  if (desc.LocalSecondaryIndexes) {
    for (const lsi of desc.LocalSecondaryIndexes) {
      if (lsi.IndexName) indexes.push(lsi.IndexName);
    }
  }

  return { tableName, partitionKey, sortKey, indexes };
}

async function listAllTables(client: DynamoDBClient): Promise<string[]> {
  const tableNames: string[] = [];
  let lastEvaluatedTableName: string | undefined;

  do {
    const command = new ListTablesCommand({
      ExclusiveStartTableName: lastEvaluatedTableName,
      Limit: 100,
    });

    const response = await client.send(command);
    if (response.TableNames) {
      tableNames.push(...response.TableNames);
    }
    lastEvaluatedTableName = response.LastEvaluatedTableName;
  } while (lastEvaluatedTableName);

  return tableNames;
}

export async function extractDynamoMetadata(
  config: InfrawiseConfig,
): Promise<DynamoTableMetadata[]> {
  const client = createDynamoClient(config);
  const includeTables = config.dynamodb?.includeTables;

  let tableNames: string[];
  try {
    const allTables = await listAllTables(client);
    if (includeTables && includeTables.length > 0) {
      tableNames = allTables.filter((name) => includeTables.includes(name));
      logger.debug(`Filtered to ${tableNames.length} tables from config`);
    } else {
      tableNames = allTables;
    }
    logger.debug(`Found ${tableNames.length} DynamoDB table(s)`);
  } catch (err) {
    throw new DynamoDBError(err instanceof Error ? err.message : 'Failed to list DynamoDB tables');
  }

  const results: DynamoTableMetadata[] = [];

  for (const tableName of tableNames) {
    try {
      const command = new DescribeTableCommand({ TableName: tableName });
      const response = await client.send(command);
      if (response.Table) {
        results.push(parseTableDescription(response.Table));
        logger.debug(`Described table: ${tableName}`);
      }
    } catch (err) {
      logger.warn(
        `Failed to describe table ${tableName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return results;
}

export async function validateDynamoAccess(config: InfrawiseConfig): Promise<boolean> {
  const client = createDynamoClient(config);
  try {
    await client.send(new ListTablesCommand({ Limit: 1 }));
    return true;
  } catch {
    return false;
  }
}

export async function probeDynamoAccess(config: InfrawiseConfig): Promise<void> {
  const client = createDynamoClient(config);
  await client.send(new ListTablesCommand({ Limit: 1 }));
}
