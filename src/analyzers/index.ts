import type { Analyzer, SystemGraph, Finding } from '../types';
import { logger } from '../core';

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

export async function runAllAnalyzers(
  graph: SystemGraph,
  analyzers: Analyzer[],
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

export function summarizeFindings(findings: Finding[]): { total: number; high: number; medium: number; low: number } {
  const counts = { total: findings.length, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
