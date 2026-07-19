import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const ddb = new DynamoDBClient({});
const secretsClient = new SecretsManagerClient({});

// BAD: SQS-triggered consumer that full-scans Orders on every invocation -> PipelineAnalyzer scan-in-consumer
// The Lambda named "fulfillment" is triggered by the orders-queue SQS queue.
// Using ScanCommand without a filter runs a full table read per message — flagged as High (IaC-proven) or Verify (name-matched).
export const handler = async () => {
  const res = await ddb.send(new ScanCommand({ TableName: 'orders' }));
  return res.Items?.length ?? 0;
};

// Demonstrates secret key inference: get_secrets_overview reports referencedKeys: ["password"]
// for "demo/db-password", inferred here from destructuring — the value itself is never read by infrawise.
export async function connectToDb() {
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: 'demo/db-password' }),
  );
  const { password } = JSON.parse(res.SecretString ?? '{}');
  return password;
}
