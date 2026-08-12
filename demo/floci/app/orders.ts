// Deployed as the Lambda "processOrders" (terraform/main.tf), whose handler is
// "orders.handler" — the name in the account and the name in the repo share no
// string, which is the case a running assistant has to resolve.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

export async function handler(event: { Records: { body: string }[] }) {
  for (const record of event.Records) {
    const { userId } = JSON.parse(record.body) as { userId: string };

    await doc.send(
      new QueryCommand({
        TableName: 'Users',
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :e',
        ExpressionAttributeValues: { ':e': userId },
      }),
    );

    await doc.send(new ScanCommand({ TableName: 'Orders' }));

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: 'http://localhost:4566/000000000000/report-trigger-queue',
        MessageBody: record.body,
      }),
    );
  }
}
