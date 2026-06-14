import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const ddb = new DynamoDBClient({});

// BAD: SQS-triggered consumer that full-scans Orders on every invocation → PipelineAnalyzer scan-in-consumer
// The Lambda named "fulfillment" is triggered by the orders-queue SQS queue.
// Using ScanCommand without a filter runs a full table read per message — flagged as High (IaC-proven) or Verify (name-matched).
export const handler = async () => {
  const res = await ddb.send(new ScanCommand({ TableName: 'orders' }));
  return res.Items?.length ?? 0;
};
