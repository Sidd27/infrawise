import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { logger } from '../../core/index.js';

export type IaCSource = 'terraform' | 'cloudformation' | 'cdk';

export interface IaCDynamoTable {
  name: string;
  partitionKey?: string;
  sortKey?: string;
  gsiNames: string[];
  source: IaCSource;
  filePath: string;
}

export interface IaCRDSInstance {
  identifier: string;
  engine: string;
  source: IaCSource;
  filePath: string;
}

export interface IaCMongoCluster {
  identifier: string;
  source: IaCSource;
  filePath: string;
}

export interface IaCQueue {
  name: string;
  hasDLQ: boolean;
  encrypted: boolean;
  source: IaCSource;
  filePath: string;
}

export interface IaCTopic {
  name: string;
  encrypted: boolean;
  source: IaCSource;
  filePath: string;
}

export interface IaCLambda {
  name: string;
  runtime?: string;
  source: IaCSource;
  filePath: string;
}

export interface IaCBucket {
  name: string;
  versioned: boolean;
  source: IaCSource;
  filePath: string;
}

export interface IaCParameter {
  name: string;
  type: string;
  source: IaCSource;
  filePath: string;
}

export interface IaCSecret {
  name: string;
  source: IaCSource;
  filePath: string;
}

export interface IaCApiGateway {
  name: string;
  source: IaCSource;
  filePath: string;
}

export interface IaCSchema {
  dynamoTables: IaCDynamoTable[];
  rdsInstances: IaCRDSInstance[];
  mongoClusters: IaCMongoCluster[];
  queues: IaCQueue[];
  topics: IaCTopic[];
  lambdas: IaCLambda[];
  buckets: IaCBucket[];
  parameters: IaCParameter[];
  secrets: IaCSecret[];
  apiGateways: IaCApiGateway[];
}

function emptySchema(): IaCSchema {
  return {
    dynamoTables: [],
    rdsInstances: [],
    mongoClusters: [],
    queues: [],
    topics: [],
    lambdas: [],
    buckets: [],
    parameters: [],
    secrets: [],
    apiGateways: [],
  };
}

// ─── File discovery ───────────────────────────────────────────────────────────

function findFilesRecursively(dir: string, extensions: string[], skipDirs = new Set(['node_modules', '.git', 'dist', '.infrawise'])): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursively(fullPath, extensions, skipDirs));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ─── Terraform HCL parser ─────────────────────────────────────────────────────

function extractTerraformResourceBlocks(content: string): Array<{ resourceType: string; resourceName: string; body: string }> {
  const results: Array<{ resourceType: string; resourceName: string; body: string }> = [];
  const resourcePattern = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = resourcePattern.exec(content)) !== null) {
    const resourceType = match[1] ?? '';
    const resourceName = match[2] ?? '';
    const startBrace = match.index + match[0].length - 1;

    let depth = 1;
    let i = startBrace + 1;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
      i++;
    }
    results.push({ resourceType, resourceName, body: content.slice(startBrace + 1, i - 1) });
  }
  return results;
}

function tfStr(body: string, attr: string): string | undefined {
  const m = body.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, 'i'));
  return m?.[1];
}

function tfBool(body: string, attr: string): boolean {
  const m = body.match(new RegExp(`${attr}\\s*=\\s*(true|false)`, 'i'));
  return m?.[1] === 'true';
}

function tfGSINames(body: string): string[] {
  const names: string[] = [];
  const pat = /global_secondary_index\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = pat.exec(body)) !== null) {
    const nameMatch = m[1].match(/name\s*=\s*"([^"]*)"/);
    if (nameMatch?.[1]) names.push(nameMatch[1]);
  }
  return names;
}

export async function extractTerraformSchema(repoPath: string): Promise<IaCSchema> {
  const schema = emptySchema();
  const tfFiles = findFilesRecursively(repoPath, ['.tf']);
  logger.debug(`Found ${tfFiles.length} Terraform file(s)`);

  for (const filePath of tfFiles) {
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }

    for (const { resourceType, resourceName, body } of extractTerraformResourceBlocks(content)) {
      switch (resourceType) {
        case 'aws_dynamodb_table':
          schema.dynamoTables.push({
            name: tfStr(body, 'name') ?? resourceName,
            partitionKey: tfStr(body, 'hash_key'),
            sortKey: tfStr(body, 'range_key'),
            gsiNames: tfGSINames(body),
            source: 'terraform', filePath,
          });
          break;

        case 'aws_db_instance':
        case 'aws_rds_cluster':
          schema.rdsInstances.push({
            identifier: tfStr(body, 'identifier') ?? tfStr(body, 'cluster_identifier') ?? resourceName,
            engine: tfStr(body, 'engine') ?? 'unknown',
            source: 'terraform', filePath,
          });
          break;

        case 'aws_docdb_cluster':
          schema.mongoClusters.push({
            identifier: tfStr(body, 'cluster_identifier') ?? resourceName,
            source: 'terraform', filePath,
          });
          break;

        case 'aws_sqs_queue': {
          const name = tfStr(body, 'name') ?? resourceName;
          const hasDLQ = body.includes('redrive_policy');
          const encrypted = body.includes('kms_master_key_id') || tfBool(body, 'sqs_managed_sse_enabled');
          schema.queues.push({ name, hasDLQ, encrypted, source: 'terraform', filePath });
          break;
        }

        case 'aws_sns_topic':
          schema.topics.push({
            name: tfStr(body, 'name') ?? resourceName,
            encrypted: body.includes('kms_master_key_id'),
            source: 'terraform', filePath,
          });
          break;

        case 'aws_lambda_function':
          schema.lambdas.push({
            name: tfStr(body, 'function_name') ?? resourceName,
            runtime: tfStr(body, 'runtime'),
            source: 'terraform', filePath,
          });
          break;

        case 'aws_s3_bucket':
          schema.buckets.push({
            name: tfStr(body, 'bucket') ?? tfStr(body, 'bucket_prefix') ?? resourceName,
            versioned: body.includes('versioning') && body.includes('enabled = true'),
            source: 'terraform', filePath,
          });
          break;

        case 'aws_ssm_parameter':
          schema.parameters.push({
            name: tfStr(body, 'name') ?? resourceName,
            type: tfStr(body, 'type') ?? 'String',
            source: 'terraform', filePath,
          });
          break;

        case 'aws_secretsmanager_secret':
          schema.secrets.push({
            name: tfStr(body, 'name') ?? resourceName,
            source: 'terraform', filePath,
          });
          break;

        case 'aws_api_gateway_rest_api':
        case 'aws_apigatewayv2_api':
          schema.apiGateways.push({
            name: tfStr(body, 'name') ?? resourceName,
            source: 'terraform', filePath,
          });
          break;
      }
    }
  }

  return schema;
}

// ─── CloudFormation / CDK parser ──────────────────────────────────────────────

function isCloudFormationTemplate(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return 'AWSTemplateFormatVersion' in obj || ('Resources' in obj && typeof obj['Resources'] === 'object');
}

function parseCFNFile(filePath: string): Record<string, unknown> | null {
  let content: string;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return null; }

  if (!content.includes('AWSTemplateFormatVersion') && !content.includes('Resources')) return null;

  let parsed: unknown;
  try {
    parsed = filePath.endsWith('.json') ? JSON.parse(content) : yaml.load(content);
  } catch { return null; }

  if (!isCloudFormationTemplate(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function cfnStr(props: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof props[key] === 'string') return props[key] as string;
  }
  return undefined;
}

function cfnBool(props: Record<string, unknown>, key: string): boolean {
  return props[key] === true || props[key] === 'true' || props[key] === 'Enabled';
}

function processCFNResources(
  resources: Record<string, unknown>,
  schema: IaCSchema,
  filePath: string,
  source: IaCSource,
): void {
  for (const [logicalId, rawResource] of Object.entries(resources)) {
    if (typeof rawResource !== 'object' || rawResource === null) continue;
    const resource = rawResource as Record<string, unknown>;
    const resourceType = resource['Type'] as string | undefined;
    const props = (resource['Properties'] ?? {}) as Record<string, unknown>;

    switch (resourceType) {
      case 'AWS::DynamoDB::Table': {
        let pk: string | undefined, sk: string | undefined;
        const keySchema = props['KeySchema'];
        if (Array.isArray(keySchema)) {
          for (const kd of keySchema) {
            if (typeof kd !== 'object' || kd === null) continue;
            const k = kd as Record<string, unknown>;
            if (k['KeyType'] === 'HASH') pk = k['AttributeName'] as string | undefined;
            if (k['KeyType'] === 'RANGE') sk = k['AttributeName'] as string | undefined;
          }
        }
        const gsiNames: string[] = [];
        const gsis = props['GlobalSecondaryIndexes'];
        if (Array.isArray(gsis)) {
          for (const g of gsis) {
            if (typeof g === 'object' && g !== null) {
              const gi = g as Record<string, unknown>;
              if (typeof gi['IndexName'] === 'string') gsiNames.push(gi['IndexName']);
            }
          }
        }
        schema.dynamoTables.push({
          name: cfnStr(props, 'TableName') ?? logicalId,
          partitionKey: pk,
          sortKey: sk,
          gsiNames,
          source, filePath,
        });
        break;
      }

      case 'AWS::RDS::DBInstance':
        schema.rdsInstances.push({
          identifier: cfnStr(props, 'DBInstanceIdentifier') ?? logicalId,
          engine: cfnStr(props, 'Engine') ?? 'unknown',
          source, filePath,
        });
        break;

      case 'AWS::RDS::DBCluster':
        schema.rdsInstances.push({
          identifier: cfnStr(props, 'DBClusterIdentifier') ?? logicalId,
          engine: cfnStr(props, 'Engine') ?? 'aurora',
          source, filePath,
        });
        break;

      case 'AWS::DocDB::DBCluster':
        schema.mongoClusters.push({
          identifier: cfnStr(props, 'DBClusterIdentifier') ?? logicalId,
          source, filePath,
        });
        break;

      case 'AWS::SQS::Queue': {
        const name = cfnStr(props, 'QueueName') ?? logicalId;
        const hasDLQ = !!props['RedrivePolicy'];
        const encrypted = !!(props['KmsMasterKeyId'] || cfnBool(props, 'SqsManagedSseEnabled'));
        schema.queues.push({ name, hasDLQ, encrypted, source, filePath });
        break;
      }

      case 'AWS::SNS::Topic':
        schema.topics.push({
          name: cfnStr(props, 'TopicName') ?? logicalId,
          encrypted: !!props['KmsMasterKeyId'],
          source, filePath,
        });
        break;

      case 'AWS::Lambda::Function':
        schema.lambdas.push({
          name: cfnStr(props, 'FunctionName') ?? logicalId,
          runtime: cfnStr(props, 'Runtime'),
          source, filePath,
        });
        break;

      case 'AWS::S3::Bucket': {
        const versioningConfig = props['VersioningConfiguration'] as Record<string, unknown> | undefined;
        schema.buckets.push({
          name: cfnStr(props, 'BucketName') ?? logicalId,
          versioned: versioningConfig?.['Status'] === 'Enabled',
          source, filePath,
        });
        break;
      }

      case 'AWS::SSM::Parameter':
        schema.parameters.push({
          name: cfnStr(props, 'Name') ?? logicalId,
          type: cfnStr(props, 'Type') ?? 'String',
          source, filePath,
        });
        break;

      case 'AWS::SecretsManager::Secret':
        schema.secrets.push({
          name: cfnStr(props, 'Name') ?? logicalId,
          source, filePath,
        });
        break;

      case 'AWS::ApiGateway::RestApi':
      case 'AWS::ApiGatewayV2::Api':
        schema.apiGateways.push({
          name: cfnStr(props, 'Name') ?? logicalId,
          source, filePath,
        });
        break;
    }
  }
}

export async function extractCloudFormationSchema(repoPath: string): Promise<IaCSchema> {
  const schema = emptySchema();
  const cfnFiles = findFilesRecursively(repoPath, ['.yaml', '.yml', '.json']);
  logger.debug(`Scanning ${cfnFiles.length} potential CloudFormation file(s)`);

  for (const filePath of cfnFiles) {
    const parsed = parseCFNFile(filePath);
    if (!parsed) continue;
    const resources = parsed['Resources'] as Record<string, unknown> | undefined;
    if (!resources) continue;
    processCFNResources(resources, schema, filePath, 'cloudformation');
  }

  return schema;
}

// ─── CDK parser ───────────────────────────────────────────────────────────────

export async function extractCDKSchema(repoPath: string): Promise<IaCSchema> {
  const schema = emptySchema();

  // Strategy 1: Parse cdk.out/*.template.json (synthesized CloudFormation)
  const cdkOutDir = path.join(repoPath, 'cdk.out');
  if (fs.existsSync(cdkOutDir)) {
    const templateFiles = fs.readdirSync(cdkOutDir)
      .filter((f) => f.endsWith('.template.json'))
      .map((f) => path.join(cdkOutDir, f));

    logger.debug(`Found ${templateFiles.length} CDK synthesized template(s) in cdk.out/`);

    for (const filePath of templateFiles) {
      const parsed = parseCFNFile(filePath);
      if (!parsed) continue;
      const resources = parsed['Resources'] as Record<string, unknown> | undefined;
      if (!resources) continue;
      processCFNResources(resources, schema, filePath, 'cdk');
    }
  }

  // Strategy 2: Detect CDK TypeScript construct patterns if no cdk.out exists
  if (schema.queues.length === 0 && schema.topics.length === 0 && schema.lambdas.length === 0) {
    const cdkJsonPath = path.join(repoPath, 'cdk.json');
    if (fs.existsSync(cdkJsonPath)) {
      logger.debug('CDK project detected (cdk.json found) — run `cdk synth` for full IaC analysis');
    }
  }

  return schema;
}

// ─── Combined ─────────────────────────────────────────────────────────────────

function mergeSchemas(...schemas: IaCSchema[]): IaCSchema {
  const merged = emptySchema();

  const seen = {
    dynamo: new Set<string>(),
    rds: new Set<string>(),
    mongo: new Set<string>(),
    queue: new Set<string>(),
    topic: new Set<string>(),
    lambda: new Set<string>(),
    bucket: new Set<string>(),
    param: new Set<string>(),
    secret: new Set<string>(),
    api: new Set<string>(),
  };

  for (const schema of schemas) {
    for (const t of schema.dynamoTables) {
      const k = `${t.source}::${t.name}`;
      if (!seen.dynamo.has(k)) { seen.dynamo.add(k); merged.dynamoTables.push(t); }
    }
    for (const r of schema.rdsInstances) {
      const k = `${r.source}::${r.identifier}`;
      if (!seen.rds.has(k)) { seen.rds.add(k); merged.rdsInstances.push(r); }
    }
    for (const m of schema.mongoClusters) {
      const k = `${m.source}::${m.identifier}`;
      if (!seen.mongo.has(k)) { seen.mongo.add(k); merged.mongoClusters.push(m); }
    }
    for (const q of schema.queues) {
      const k = `${q.source}::${q.name}`;
      if (!seen.queue.has(k)) { seen.queue.add(k); merged.queues.push(q); }
    }
    for (const t of schema.topics) {
      const k = `${t.source}::${t.name}`;
      if (!seen.topic.has(k)) { seen.topic.add(k); merged.topics.push(t); }
    }
    for (const l of schema.lambdas) {
      const k = `${l.source}::${l.name}`;
      if (!seen.lambda.has(k)) { seen.lambda.add(k); merged.lambdas.push(l); }
    }
    for (const b of schema.buckets) {
      const k = `${b.source}::${b.name}`;
      if (!seen.bucket.has(k)) { seen.bucket.add(k); merged.buckets.push(b); }
    }
    for (const p of schema.parameters) {
      const k = `${p.source}::${p.name}`;
      if (!seen.param.has(k)) { seen.param.add(k); merged.parameters.push(p); }
    }
    for (const s of schema.secrets) {
      const k = `${s.source}::${s.name}`;
      if (!seen.secret.has(k)) { seen.secret.add(k); merged.secrets.push(s); }
    }
    for (const a of schema.apiGateways) {
      const k = `${a.source}::${a.name}`;
      if (!seen.api.has(k)) { seen.api.add(k); merged.apiGateways.push(a); }
    }
  }

  return merged;
}

export async function extractIaCSchema(repoPath: string): Promise<IaCSchema> {
  const [tfSchema, cfnSchema, cdkSchema] = await Promise.all([
    extractTerraformSchema(repoPath),
    extractCloudFormationSchema(repoPath),
    extractCDKSchema(repoPath),
  ]);

  const merged = mergeSchemas(tfSchema, cfnSchema, cdkSchema);

  const total = merged.dynamoTables.length + merged.rdsInstances.length +
    merged.mongoClusters.length + merged.queues.length + merged.topics.length +
    merged.lambdas.length + merged.buckets.length + merged.parameters.length +
    merged.secrets.length + merged.apiGateways.length;

  logger.debug(`IaC schema total: ${total} resource(s) across TF/CFN/CDK`);
  return merged;
}
