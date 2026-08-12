import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import type { DynamoIndexMetadata, DynamoTableMetadata, InfrawiseConfig } from '../../types.js';
import { InfrawiseError, logger } from '../../core/index.js';

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

  // KeySchema comes back on the same DescribeTable call. Keeping only the name
  // would leave a caller unable to tell whether an index covers its query.
  const indexes: DynamoIndexMetadata[] = [];
  const collectIndexes = (
    list: NonNullable<TableDescription['GlobalSecondaryIndexes' | 'LocalSecondaryIndexes']>,
    indexType: 'GSI' | 'LSI',
  ) => {
    for (const idx of list) {
      if (!idx.IndexName) continue;
      indexes.push({
        name: idx.IndexName,
        indexType,
        partitionKey: idx.KeySchema?.find((k) => k.KeyType === 'HASH')?.AttributeName,
        sortKey: idx.KeySchema?.find((k) => k.KeyType === 'RANGE')?.AttributeName,
        projectionType: idx.Projection?.ProjectionType,
      });
    }
  };

  if (desc.GlobalSecondaryIndexes) collectIndexes(desc.GlobalSecondaryIndexes, 'GSI');
  if (desc.LocalSecondaryIndexes) collectIndexes(desc.LocalSecondaryIndexes, 'LSI');

  const billingMode = desc.BillingModeSummary?.BillingMode;
  const provisionedThroughput =
    desc.ProvisionedThroughput?.ReadCapacityUnits !== undefined &&
    desc.ProvisionedThroughput?.WriteCapacityUnits !== undefined
      ? {
          readCapacityUnits: desc.ProvisionedThroughput.ReadCapacityUnits,
          writeCapacityUnits: desc.ProvisionedThroughput.WriteCapacityUnits,
        }
      : undefined;

  return { tableName, partitionKey, sortKey, indexes, billingMode, provisionedThroughput };
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
    throw new InfrawiseError(
      'Unable to access DynamoDB.',
      [
        'Insufficient IAM permissions (need dynamodb:ListTables, dynamodb:DescribeTable)',
        'Wrong AWS region configured',
        'DynamoDB endpoint not reachable',
        err instanceof Error ? err.message : 'Failed to list DynamoDB tables',
      ],
      'infrawise doctor',
    );
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
