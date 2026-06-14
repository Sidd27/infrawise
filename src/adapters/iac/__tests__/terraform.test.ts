import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractTerraformSchema,
  extractCloudFormationSchema,
  extractCDKSchema,
  extractIaCSchema,
} from '../terraform';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-iac-'));
}

function write(dir: string, file: string, content: string): string {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

let dir: string;
beforeEach(() => {
  dir = tmpDir();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── Terraform ─────────────────────────────────────────────────────────────

describe('extractTerraformSchema', () => {
  it('returns empty schema for directory with no .tf files', async () => {
    const schema = await extractTerraformSchema(dir);
    expect(schema.dynamoTables).toHaveLength(0);
    expect(schema.queues).toHaveLength(0);
    expect(schema.lambdas).toHaveLength(0);
  });

  it('returns empty schema for non-existent directory', async () => {
    const schema = await extractTerraformSchema(path.join(dir, 'missing'));
    expect(schema.dynamoTables).toHaveLength(0);
  });

  it('parses DynamoDB table with name, partition key, sort key, and GSIs', async () => {
    write(
      dir,
      'main.tf',
      `
resource "aws_dynamodb_table" "orders" {
  name      = "Orders"
  hash_key  = "orderId"
  range_key = "createdAt"

  global_secondary_index {
    name = "UserIndex"
    hash_key = "userId"
  }
  global_secondary_index {
    name = "StatusIndex"
    hash_key = "status"
  }
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.dynamoTables).toHaveLength(1);
    const t = schema.dynamoTables[0];
    expect(t.name).toBe('Orders');
    expect(t.partitionKey).toBe('orderId');
    expect(t.sortKey).toBe('createdAt');
    expect(t.gsiNames).toEqual(['UserIndex', 'StatusIndex']);
    expect(t.source).toBe('terraform');
  });

  it('falls back to resource logical name when DynamoDB name attribute is absent', async () => {
    write(
      dir,
      'main.tf',
      `
resource "aws_dynamodb_table" "sessions" {
  hash_key = "sessionId"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.dynamoTables[0].name).toBe('sessions');
    expect(schema.dynamoTables[0].gsiNames).toEqual([]);
  });

  it('parses SQS queue with DLQ and KMS encryption', async () => {
    write(
      dir,
      'queues.tf',
      `
resource "aws_sqs_queue" "orders" {
  name              = "orders-queue"
  kms_master_key_id = "alias/aws/sqs"
  redrive_policy    = jsonencode({ deadLetterTargetArn = "arn:aws:sqs:us-east-1:1234:dlq" })
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.queues).toHaveLength(1);
    const q = schema.queues[0];
    expect(q.name).toBe('orders-queue');
    expect(q.hasDLQ).toBe(true);
    expect(q.encrypted).toBe(true);
  });

  it('parses SQS queue with SSE managed encryption and no DLQ', async () => {
    write(
      dir,
      'queues.tf',
      `
resource "aws_sqs_queue" "notifications" {
  name                    = "notifications-queue"
  sqs_managed_sse_enabled = true
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    const q = schema.queues[0];
    expect(q.hasDLQ).toBe(false);
    expect(q.encrypted).toBe(true);
  });

  it('parses unencrypted SQS queue with no DLQ', async () => {
    write(
      dir,
      'queues.tf',
      `
resource "aws_sqs_queue" "plain" {
  name = "plain-queue"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    const q = schema.queues[0];
    expect(q.hasDLQ).toBe(false);
    expect(q.encrypted).toBe(false);
  });

  it('parses SNS topic with KMS encryption', async () => {
    write(
      dir,
      'topics.tf',
      `
resource "aws_sns_topic" "alerts" {
  name              = "alerts-topic"
  kms_master_key_id = "alias/aws/sns"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.topics).toHaveLength(1);
    expect(schema.topics[0].name).toBe('alerts-topic');
    expect(schema.topics[0].encrypted).toBe(true);
  });

  it('parses Lambda function with runtime', async () => {
    write(
      dir,
      'lambdas.tf',
      `
resource "aws_lambda_function" "processor" {
  function_name = "order-processor"
  runtime       = "nodejs22.x"
  handler       = "index.handler"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.lambdas).toHaveLength(1);
    expect(schema.lambdas[0].name).toBe('order-processor');
    expect(schema.lambdas[0].runtime).toBe('nodejs22.x');
  });

  it('parses aws_db_instance as RDS', async () => {
    write(
      dir,
      'rds.tf',
      `
resource "aws_db_instance" "main" {
  identifier = "prod-postgres"
  engine     = "postgres"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.rdsInstances).toHaveLength(1);
    expect(schema.rdsInstances[0].identifier).toBe('prod-postgres');
    expect(schema.rdsInstances[0].engine).toBe('postgres');
  });

  it('parses aws_rds_cluster as RDS', async () => {
    write(
      dir,
      'rds.tf',
      `
resource "aws_rds_cluster" "aurora" {
  cluster_identifier = "aurora-cluster"
  engine             = "aurora-mysql"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.rdsInstances[0].identifier).toBe('aurora-cluster');
    expect(schema.rdsInstances[0].engine).toBe('aurora-mysql');
  });

  it('parses DocumentDB cluster as MongoDB', async () => {
    write(
      dir,
      'docdb.tf',
      `
resource "aws_docdb_cluster" "main" {
  cluster_identifier = "docdb-cluster"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.mongoClusters).toHaveLength(1);
    expect(schema.mongoClusters[0].identifier).toBe('docdb-cluster');
  });

  it('parses S3 bucket with versioning enabled', async () => {
    write(
      dir,
      's3.tf',
      `
resource "aws_s3_bucket" "assets" {
  bucket = "my-assets-bucket"

  versioning {
    enabled = true
  }
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.buckets).toHaveLength(1);
    expect(schema.buckets[0].name).toBe('my-assets-bucket');
    expect(schema.buckets[0].versioned).toBe(true);
  });

  it('parses SSM parameter with type', async () => {
    write(
      dir,
      'ssm.tf',
      `
resource "aws_ssm_parameter" "api_key" {
  name  = "/app/api-key"
  type  = "SecureString"
  value = "secret"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.parameters).toHaveLength(1);
    expect(schema.parameters[0].name).toBe('/app/api-key');
    expect(schema.parameters[0].type).toBe('SecureString');
  });

  it('parses Secrets Manager secret', async () => {
    write(
      dir,
      'secrets.tf',
      `
resource "aws_secretsmanager_secret" "db_password" {
  name = "prod/db/password"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.secrets).toHaveLength(1);
    expect(schema.secrets[0].name).toBe('prod/db/password');
    expect(schema.secrets[0].source).toBe('terraform');
  });

  it('parses REST API Gateway', async () => {
    write(
      dir,
      'apigw.tf',
      `
resource "aws_api_gateway_rest_api" "main" {
  name = "orders-api"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.apiGateways).toHaveLength(1);
    expect(schema.apiGateways[0].name).toBe('orders-api');
  });

  it('parses HTTP API Gateway v2', async () => {
    write(
      dir,
      'apigw.tf',
      `
resource "aws_apigatewayv2_api" "http" {
  name          = "http-api"
  protocol_type = "HTTP"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.apiGateways[0].name).toBe('http-api');
  });

  it('skips node_modules directory', async () => {
    write(
      dir,
      'node_modules/some-package/infra.tf',
      `
resource "aws_dynamodb_table" "should_be_ignored" {
  name = "IgnoredTable"
}
`,
    );
    write(
      dir,
      'main.tf',
      `
resource "aws_dynamodb_table" "real" {
  name = "RealTable"
}
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.dynamoTables).toHaveLength(1);
    expect(schema.dynamoTables[0].name).toBe('RealTable');
  });

  it('aggregates resources from multiple .tf files', async () => {
    write(
      dir,
      'dynamo.tf',
      `
resource "aws_dynamodb_table" "orders" { name = "Orders" }
`,
    );
    write(
      dir,
      'queues.tf',
      `
resource "aws_sqs_queue" "events" { name = "events-queue" }
`,
    );
    write(
      dir,
      'lambdas.tf',
      `
resource "aws_lambda_function" "handler" { function_name = "handler" }
`,
    );
    const schema = await extractTerraformSchema(dir);
    expect(schema.dynamoTables).toHaveLength(1);
    expect(schema.queues).toHaveLength(1);
    expect(schema.lambdas).toHaveLength(1);
  });
});

// ─── CloudFormation ────────────────────────────────────────────────────────

describe('extractCloudFormationSchema', () => {
  it('returns empty schema for directory with no YAML/JSON files', async () => {
    write(dir, 'notes.txt', 'not a template');
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.dynamoTables).toHaveLength(0);
  });

  it('ignores YAML files that are not CloudFormation templates', async () => {
    write(
      dir,
      'docker-compose.yml',
      `
version: '3'
services:
  web:
    image: nginx
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.dynamoTables).toHaveLength(0);
  });

  it('parses DynamoDB table with key schema and GSIs from YAML', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  OrdersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: Orders
      KeySchema:
        - AttributeName: orderId
          KeyType: HASH
        - AttributeName: createdAt
          KeyType: RANGE
      GlobalSecondaryIndexes:
        - IndexName: UserIndex
          KeySchema:
            - AttributeName: userId
              KeyType: HASH
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.dynamoTables).toHaveLength(1);
    const t = schema.dynamoTables[0];
    expect(t.name).toBe('Orders');
    expect(t.partitionKey).toBe('orderId');
    expect(t.sortKey).toBe('createdAt');
    expect(t.gsiNames).toEqual(['UserIndex']);
    expect(t.source).toBe('cloudformation');
  });

  it('falls back to logical ID when TableName is absent', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  SessionsTable:
    Type: AWS::DynamoDB::Table
    Properties: {}
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.dynamoTables[0].name).toBe('SessionsTable');
  });

  it('parses SQS queue with RedrivePolicy as having DLQ', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  OrdersQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: orders-queue
      KmsMasterKeyId: alias/aws/sqs
      RedrivePolicy:
        deadLetterTargetArn: "arn:aws:sqs:us-east-1:123456789:orders-dlq"
        maxReceiveCount: 5
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.queues).toHaveLength(1);
    expect(schema.queues[0].name).toBe('orders-queue');
    expect(schema.queues[0].hasDLQ).toBe(true);
    expect(schema.queues[0].encrypted).toBe(true);
  });

  it('parses SQS queue with SqsManagedSseEnabled', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  NotifQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: notif-queue
      SqsManagedSseEnabled: true
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.queues[0].encrypted).toBe(true);
    expect(schema.queues[0].hasDLQ).toBe(false);
  });

  it('parses Lambda function', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  ProcessorFn:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: order-processor
      Runtime: nodejs22.x
      Handler: index.handler
      Role: "arn:aws:iam::123456789:role/LambdaRole"
      Code:
        ZipFile: "exports.handler = () => {}"
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.lambdas).toHaveLength(1);
    expect(schema.lambdas[0].name).toBe('order-processor');
    expect(schema.lambdas[0].runtime).toBe('nodejs22.x');
  });

  it('parses SNS topic with KMS key', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  AlertsTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: alerts
      KmsMasterKeyId: alias/aws/sns
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.topics[0].name).toBe('alerts');
    expect(schema.topics[0].encrypted).toBe(true);
  });

  it('parses RDS DB instance', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  ProdDB:
    Type: AWS::RDS::DBInstance
    Properties:
      DBInstanceIdentifier: prod-db
      Engine: postgres
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.rdsInstances[0].identifier).toBe('prod-db');
    expect(schema.rdsInstances[0].engine).toBe('postgres');
  });

  it('parses S3 bucket with versioning', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  AssetsBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-assets
      VersioningConfiguration:
        Status: Enabled
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.buckets[0].name).toBe('my-assets');
    expect(schema.buckets[0].versioned).toBe(true);
  });

  it('parses Secrets Manager secret', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  DBSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: prod/db/password
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.secrets[0].name).toBe('prod/db/password');
    expect(schema.secrets[0].source).toBe('cloudformation');
  });

  it('parses SSM parameter', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  ApiKeyParam:
    Type: AWS::SSM::Parameter
    Properties:
      Name: /app/api-key
      Type: SecureString
      Value: placeholder
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.parameters[0].name).toBe('/app/api-key');
    expect(schema.parameters[0].type).toBe('SecureString');
  });

  it('parses API Gateway REST API', async () => {
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  OrdersApi:
    Type: AWS::ApiGateway::RestApi
    Properties:
      Name: orders-api
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.apiGateways[0].name).toBe('orders-api');
    expect(schema.apiGateways[0].source).toBe('cloudformation');
  });

  it('parses JSON CloudFormation template', async () => {
    write(
      dir,
      'template.json',
      JSON.stringify({
        AWSTemplateFormatVersion: '2010-09-09',
        Resources: {
          EventsQueue: {
            Type: 'AWS::SQS::Queue',
            Properties: { QueueName: 'events-queue' },
          },
        },
      }),
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.queues[0].name).toBe('events-queue');
  });

  it('parses multiple resource types from a single template', async () => {
    write(
      dir,
      'stack.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  OrdersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: Orders
      KeySchema:
        - AttributeName: id
          KeyType: HASH
  OrdersQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: orders-queue
  ProcessorFn:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: processor
      Handler: index.handler
      Role: arn:aws:iam::123:role/LambdaRole
      Code:
        ZipFile: exports.handler = () => {}
`,
    );
    const schema = await extractCloudFormationSchema(dir);
    expect(schema.dynamoTables).toHaveLength(1);
    expect(schema.queues).toHaveLength(1);
    expect(schema.lambdas).toHaveLength(1);
  });
});

// ─── CDK ───────────────────────────────────────────────────────────────────

describe('extractCDKSchema', () => {
  it('returns empty schema when no cdk.out directory exists', async () => {
    const schema = await extractCDKSchema(dir);
    expect(schema.dynamoTables).toHaveLength(0);
    expect(schema.queues).toHaveLength(0);
  });

  it('reads synthesized templates from cdk.out/', async () => {
    write(
      dir,
      'cdk.out/MyStack.template.json',
      JSON.stringify({
        AWSTemplateFormatVersion: '2010-09-09',
        Resources: {
          OrdersQueue: {
            Type: 'AWS::SQS::Queue',
            Properties: { QueueName: 'cdk-orders-queue' },
          },
          ProcessorFn: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              FunctionName: 'cdk-processor',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
              Role: 'arn:aws:iam::123:role/Role',
              Code: { ZipFile: 'exports.handler = () => {}' },
            },
          },
        },
      }),
    );
    const schema = await extractCDKSchema(dir);
    expect(schema.queues).toHaveLength(1);
    expect(schema.queues[0].name).toBe('cdk-orders-queue');
    expect(schema.queues[0].source).toBe('cdk');
    expect(schema.lambdas[0].name).toBe('cdk-processor');
  });

  it('reads multiple synthesized stack templates', async () => {
    write(
      dir,
      'cdk.out/StackA.template.json',
      JSON.stringify({
        AWSTemplateFormatVersion: '2010-09-09',
        Resources: {
          TableA: {
            Type: 'AWS::DynamoDB::Table',
            Properties: {
              TableName: 'TableA',
              KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
            },
          },
        },
      }),
    );
    write(
      dir,
      'cdk.out/StackB.template.json',
      JSON.stringify({
        AWSTemplateFormatVersion: '2010-09-09',
        Resources: {
          TableB: {
            Type: 'AWS::DynamoDB::Table',
            Properties: {
              TableName: 'TableB',
              KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
            },
          },
        },
      }),
    );
    const schema = await extractCDKSchema(dir);
    expect(schema.dynamoTables).toHaveLength(2);
    const names = schema.dynamoTables.map((t) => t.name).sort();
    expect(names).toEqual(['TableA', 'TableB']);
  });
});

// ─── IaC lambda handler extraction ─────────────────────────────────────────

describe('IaC lambda handler extraction', () => {
  it('captures handler from a terraform aws_lambda_function', async () => {
    write(
      dir,
      'main.tf',
      `resource "aws_lambda_function" "fulfill" {
         function_name = "fulfill-prod"
         runtime       = "nodejs20.x"
         handler       = "src/fulfill.handler"
       }`,
    );
    const schema = await extractTerraformSchema(dir);
    const fn = schema.lambdas.find((l) => l.name === 'fulfill-prod');
    expect(fn?.handler).toBe('src/fulfill.handler');
  });

  it('captures Handler from a CloudFormation AWS::Lambda::Function', async () => {
    write(
      dir,
      'template.yaml',
      `AWSTemplateFormatVersion: '2010-09-09'
Resources:
  Fulfill:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: fulfill-prod
      Runtime: nodejs20.x
      Handler: src/fulfill.handler`,
    );
    const schema = await extractCloudFormationSchema(dir);
    const fn = schema.lambdas.find((l) => l.name === 'fulfill-prod');
    expect(fn?.handler).toBe('src/fulfill.handler');
  });
});

// ─── Combined / merge ──────────────────────────────────────────────────────

describe('extractIaCSchema (combined)', () => {
  it('merges resources from Terraform and CloudFormation sources', async () => {
    write(
      dir,
      'main.tf',
      `
resource "aws_dynamodb_table" "tf_table" { name = "TFTable" }
`,
    );
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  CfnTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: CfnTable
      KeySchema:
        - AttributeName: id
          KeyType: HASH
`,
    );
    const schema = await extractIaCSchema(dir);
    const names = schema.dynamoTables.map((t) => t.name).sort();
    expect(names).toContain('TFTable');
    expect(names).toContain('CfnTable');
  });

  it('deduplicates resources with the same source and name', async () => {
    write(dir, 'a.tf', `resource "aws_sqs_queue" "q" { name = "shared-queue" }`);
    write(dir, 'b.tf', `resource "aws_sqs_queue" "q2" { name = "shared-queue" }`);
    const schema = await extractIaCSchema(dir);
    const queues = schema.queues.filter((q) => q.name === 'shared-queue');
    expect(queues).toHaveLength(1);
  });

  it('does not deduplicate same name across different sources', async () => {
    write(dir, 'main.tf', `resource "aws_sqs_queue" "q" { name = "shared-queue" }`);
    write(
      dir,
      'template.yaml',
      `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  SharedQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: shared-queue
`,
    );
    const schema = await extractIaCSchema(dir);
    const queues = schema.queues.filter((q) => q.name === 'shared-queue');
    expect(queues).toHaveLength(2);
    const sources = queues.map((q) => q.source).sort();
    expect(sources).toEqual(['cloudformation', 'terraform']);
  });
});
