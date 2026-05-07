import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { logger } from '@infrawise/core';

export type IaCSource = 'terraform' | 'cloudformation';

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

export interface IaCSchema {
  dynamoTables: IaCDynamoTable[];
  rdsInstances: IaCRDSInstance[];
  mongoClusters: IaCMongoCluster[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function findFilesRecursively(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursively(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ─── Terraform Parser ────────────────────────────────────────────────────────

/**
 * Extract top-level resource blocks from HCL using regex.
 * Returns an array of { resourceType, resourceName, body } objects.
 */
function extractTerraformResourceBlocks(
  content: string,
): Array<{ resourceType: string; resourceName: string; body: string }> {
  const results: Array<{ resourceType: string; resourceName: string; body: string }> = [];

  // Match: resource "TYPE" "NAME" { ... }
  // We scan manually to handle nested braces correctly
  const resourcePattern = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = resourcePattern.exec(content)) !== null) {
    const resourceType = match[1];
    const resourceName = match[2];
    const startBrace = match.index + match[0].length - 1; // position of opening {

    // Walk through to find matching closing brace
    let depth = 1;
    let i = startBrace + 1;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
      i++;
    }
    const body = content.slice(startBrace + 1, i - 1);
    results.push({ resourceType: resourceType ?? '', resourceName: resourceName ?? '', body });
  }

  return results;
}

function extractTerraformStringAttr(body: string, attr: string): string | undefined {
  const pattern = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, 'i');
  const m = body.match(pattern);
  return m?.[1];
}

function extractTerraformGSINames(body: string): string[] {
  const names: string[] = [];
  const gsiPattern = /global_secondary_index\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = gsiPattern.exec(body)) !== null) {
    const gsiBody = m[1];
    const nameMatch = gsiBody.match(/name\s*=\s*"([^"]*)"/);
    if (nameMatch?.[1]) names.push(nameMatch[1]);
  }
  return names;
}

export async function extractTerraformSchema(repoPath: string): Promise<IaCSchema> {
  const schema: IaCSchema = { dynamoTables: [], rdsInstances: [], mongoClusters: [] };
  const tfFiles = findFilesRecursively(repoPath, ['.tf']);

  logger.info(`Found ${tfFiles.length} Terraform file(s)`);

  for (const filePath of tfFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const blocks = extractTerraformResourceBlocks(content);

    for (const block of blocks) {
      const { resourceType, resourceName, body } = block;

      if (resourceType === 'aws_dynamodb_table') {
        const partitionKey = extractTerraformStringAttr(body, 'hash_key');
        const sortKey = extractTerraformStringAttr(body, 'range_key');
        const gsiNames = extractTerraformGSINames(body);
        // Use 'name' attribute if present, else fall back to resource name
        const tableName = extractTerraformStringAttr(body, 'name') ?? resourceName;

        schema.dynamoTables.push({
          name: tableName,
          partitionKey,
          sortKey,
          gsiNames,
          source: 'terraform',
          filePath,
        });
      } else if (resourceType === 'aws_db_instance') {
        const identifier = extractTerraformStringAttr(body, 'identifier') ?? resourceName;
        const engine = extractTerraformStringAttr(body, 'engine') ?? 'unknown';

        schema.rdsInstances.push({
          identifier,
          engine,
          source: 'terraform',
          filePath,
        });
      } else if (resourceType === 'aws_docdb_cluster') {
        const identifier = extractTerraformStringAttr(body, 'cluster_identifier') ?? resourceName;

        schema.mongoClusters.push({
          identifier,
          source: 'terraform',
          filePath,
        });
      }
    }
  }

  return schema;
}

// ─── CloudFormation Parser ───────────────────────────────────────────────────

function isCloudFormationTemplate(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return 'AWSTemplateFormatVersion' in obj || ('Resources' in obj && typeof obj['Resources'] === 'object');
}

function parseCFNFile(filePath: string): Record<string, unknown> | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  // Quick pre-check: skip files that definitely aren't CFN
  if (!content.includes('AWSTemplateFormatVersion') && !content.includes('Resources')) {
    return null;
  }

  let parsed: unknown;
  try {
    if (filePath.endsWith('.json')) {
      parsed = JSON.parse(content);
    } else {
      parsed = yaml.load(content);
    }
  } catch {
    return null;
  }

  if (!isCloudFormationTemplate(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function getStringProp(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  return undefined;
}

export async function extractCloudFormationSchema(repoPath: string): Promise<IaCSchema> {
  const schema: IaCSchema = { dynamoTables: [], rdsInstances: [], mongoClusters: [] };
  const cfnFiles = findFilesRecursively(repoPath, ['.yaml', '.yml', '.json']);

  logger.info(`Scanning ${cfnFiles.length} potential CloudFormation file(s)`);

  for (const filePath of cfnFiles) {
    const parsed = parseCFNFile(filePath);
    if (!parsed) continue;

    const resources = parsed['Resources'] as Record<string, unknown> | undefined;
    if (!resources || typeof resources !== 'object') continue;

    for (const [logicalId, rawResource] of Object.entries(resources)) {
      if (typeof rawResource !== 'object' || rawResource === null) continue;
      const resource = rawResource as Record<string, unknown>;
      const resourceType = resource['Type'] as string | undefined;
      const props = (resource['Properties'] ?? {}) as Record<string, unknown>;

      if (resourceType === 'AWS::DynamoDB::Table') {
        // Extract key schema
        let partitionKey: string | undefined;
        let sortKey: string | undefined;
        const keySchema = props['KeySchema'];
        if (Array.isArray(keySchema)) {
          for (const keyDef of keySchema) {
            if (typeof keyDef !== 'object' || keyDef === null) continue;
            const kd = keyDef as Record<string, unknown>;
            if (kd['KeyType'] === 'HASH') partitionKey = kd['AttributeName'] as string | undefined;
            if (kd['KeyType'] === 'RANGE') sortKey = kd['AttributeName'] as string | undefined;
          }
        }

        // Extract GSI names
        const gsiNames: string[] = [];
        const gsis = props['GlobalSecondaryIndexes'];
        if (Array.isArray(gsis)) {
          for (const gsi of gsis) {
            if (typeof gsi !== 'object' || gsi === null) continue;
            const g = gsi as Record<string, unknown>;
            if (typeof g['IndexName'] === 'string') gsiNames.push(g['IndexName']);
          }
        }

        const tableName = getStringProp(props, 'TableName') ?? logicalId;

        schema.dynamoTables.push({
          name: tableName,
          partitionKey,
          sortKey,
          gsiNames,
          source: 'cloudformation',
          filePath,
        });
      } else if (resourceType === 'AWS::RDS::DBInstance') {
        const identifier = getStringProp(props, 'DBInstanceIdentifier') ?? logicalId;
        const engine = getStringProp(props, 'Engine') ?? 'unknown';

        schema.rdsInstances.push({
          identifier,
          engine,
          source: 'cloudformation',
          filePath,
        });
      } else if (resourceType === 'AWS::DocDB::DBCluster') {
        const identifier = getStringProp(props, 'DBClusterIdentifier') ?? logicalId;

        schema.mongoClusters.push({
          identifier,
          source: 'cloudformation',
          filePath,
        });
      }
    }
  }

  return schema;
}

// ─── Combined ────────────────────────────────────────────────────────────────

export async function extractIaCSchema(repoPath: string): Promise<IaCSchema> {
  const [tfSchema, cfnSchema] = await Promise.all([
    extractTerraformSchema(repoPath),
    extractCloudFormationSchema(repoPath),
  ]);

  // Merge, deduplicating by name+source
  const dynamoKey = (t: IaCDynamoTable) => `${t.source}::${t.name}`;
  const rdsKey = (r: IaCRDSInstance) => `${r.source}::${r.identifier}`;
  const mongoKey = (m: IaCMongoCluster) => `${m.source}::${m.identifier}`;

  const seenDynamo = new Set<string>();
  const seenRds = new Set<string>();
  const seenMongo = new Set<string>();

  const dynamoTables: IaCDynamoTable[] = [];
  const rdsInstances: IaCRDSInstance[] = [];
  const mongoClusters: IaCMongoCluster[] = [];

  for (const t of [...tfSchema.dynamoTables, ...cfnSchema.dynamoTables]) {
    const k = dynamoKey(t);
    if (!seenDynamo.has(k)) { seenDynamo.add(k); dynamoTables.push(t); }
  }
  for (const r of [...tfSchema.rdsInstances, ...cfnSchema.rdsInstances]) {
    const k = rdsKey(r);
    if (!seenRds.has(k)) { seenRds.add(k); rdsInstances.push(r); }
  }
  for (const m of [...tfSchema.mongoClusters, ...cfnSchema.mongoClusters]) {
    const k = mongoKey(m);
    if (!seenMongo.has(k)) { seenMongo.add(k); mongoClusters.push(m); }
  }

  return { dynamoTables, rdsInstances, mongoClusters };
}
