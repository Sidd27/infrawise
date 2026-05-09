import type { Analyzer, SystemGraph, Finding } from '../types';
import { logger } from '../core';
import { FullTableScanAnalyzer, MissingGSIAnalyzer, HotPartitionAnalyzer } from './dynamodb';
import { MissingIndexAnalyzer, NplusOneAnalyzer, LargeSelectAnalyzer } from './postgres';
import { MissingMySQLIndexAnalyzer, MySQLFullTableScanAnalyzer } from './mysql';
import { MissingMongoIndexAnalyzer, MongoCollectionScanAnalyzer } from './mongodb';
import { IaCDriftAnalyzer } from './terraform';
import {
  MissingDLQAnalyzer,
  UnencryptedQueueAnalyzer,
  LargeQueueBacklogAnalyzer,
  MissingSecretRotationAnalyzer,
  MissingLogRetentionAnalyzer,
  LambdaDefaultMemoryAnalyzer,
  LambdaHighTimeoutAnalyzer,
} from './aws-services';
import {
  RDSPubliclyAccessibleAnalyzer,
  RDSNoBackupAnalyzer,
  RDSUnencryptedAnalyzer,
  RDSNoDeletionProtectionAnalyzer,
  RDSNoMultiAZAnalyzer,
} from './rds';

export { FullTableScanAnalyzer, MissingGSIAnalyzer, HotPartitionAnalyzer } from './dynamodb';
export { MissingIndexAnalyzer, NplusOneAnalyzer, LargeSelectAnalyzer } from './postgres';
export { MissingMySQLIndexAnalyzer, MySQLFullTableScanAnalyzer } from './mysql';
export { MissingMongoIndexAnalyzer, MongoCollectionScanAnalyzer } from './mongodb';
export { IaCDriftAnalyzer } from './terraform';
export {
  MissingDLQAnalyzer,
  UnencryptedQueueAnalyzer,
  LargeQueueBacklogAnalyzer,
  MissingSecretRotationAnalyzer,
  MissingLogRetentionAnalyzer,
  LambdaDefaultMemoryAnalyzer,
  LambdaHighTimeoutAnalyzer,
} from './aws-services';
export {
  RDSPubliclyAccessibleAnalyzer,
  RDSNoBackupAnalyzer,
  RDSUnencryptedAnalyzer,
  RDSNoDeletionProtectionAnalyzer,
  RDSNoMultiAZAnalyzer,
} from './rds';

const DEFAULT_ANALYZERS: Analyzer[] = [
  // DynamoDB
  new FullTableScanAnalyzer(),
  new MissingGSIAnalyzer(),
  new HotPartitionAnalyzer(),
  // PostgreSQL
  new MissingIndexAnalyzer(),
  new NplusOneAnalyzer(),
  new LargeSelectAnalyzer(),
  // MySQL
  new MissingMySQLIndexAnalyzer(),
  new MySQLFullTableScanAnalyzer(),
  // MongoDB
  new MissingMongoIndexAnalyzer(),
  new MongoCollectionScanAnalyzer(),
  // IaC drift
  new IaCDriftAnalyzer(),
  // SQS / messaging
  new MissingDLQAnalyzer(),
  new UnencryptedQueueAnalyzer(),
  new LargeQueueBacklogAnalyzer(),
  // Secrets Manager
  new MissingSecretRotationAnalyzer(),
  // CloudWatch Logs
  new MissingLogRetentionAnalyzer(),
  // Lambda
  new LambdaDefaultMemoryAnalyzer(),
  new LambdaHighTimeoutAnalyzer(),
  // RDS
  new RDSPubliclyAccessibleAnalyzer(),
  new RDSNoBackupAnalyzer(),
  new RDSUnencryptedAnalyzer(),
  new RDSNoDeletionProtectionAnalyzer(),
  new RDSNoMultiAZAnalyzer(),
];

export async function runAllAnalyzers(
  graph: SystemGraph,
  analyzers: Analyzer[] = DEFAULT_ANALYZERS,
): Promise<Finding[]> {
  const allFindings: Finding[] = [];

  for (const analyzer of analyzers) {
    try {
      logger.debug(`Running analyzer: ${analyzer.name}`);
      const findings = await analyzer.analyze(graph);
      logger.debug(`[${analyzer.name}] found ${findings.length} issue(s)`);
      allFindings.push(...findings);
    } catch (err) {
      logger.warn(
        `Analyzer "${analyzer.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const severityOrder = { high: 0, medium: 1, low: 2 };
  allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return allFindings;
}

export function summarizeFindings(findings: Finding[]): {
  total: number;
  high: number;
  medium: number;
  low: number;
} {
  return {
    total: findings.length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
  };
}
