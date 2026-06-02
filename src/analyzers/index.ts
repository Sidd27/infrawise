import type { Analyzer, SystemGraph, Finding } from '../types.js';
import { logger } from '../core/index.js';

export { FullTableScanAnalyzer, MissingGSIAnalyzer, HotPartitionAnalyzer } from './dynamodb.js';
export { MissingIndexAnalyzer, NplusOneAnalyzer, LargeSelectAnalyzer } from './postgres.js';
export { MissingMySQLIndexAnalyzer, MySQLFullTableScanAnalyzer } from './mysql.js';
export { MissingMongoIndexAnalyzer, MongoCollectionScanAnalyzer } from './mongodb.js';
export { IaCDriftAnalyzer } from './terraform.js';
export {
  MissingDLQAnalyzer,
  UnencryptedQueueAnalyzer,
  LargeQueueBacklogAnalyzer,
  MissingSecretRotationAnalyzer,
  MissingLogRetentionAnalyzer,
  LambdaDefaultMemoryAnalyzer,
  LambdaHighTimeoutAnalyzer,
  LambdaMissingTriggerDLQAnalyzer,
} from './aws-services.js';
export {
  RDSPubliclyAccessibleAnalyzer,
  RDSNoBackupAnalyzer,
  RDSUnencryptedAnalyzer,
  RDSNoDeletionProtectionAnalyzer,
  RDSNoMultiAZAnalyzer,
} from './rds.js';

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

  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2, verify: 3 };
  allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return allFindings;
}

export function summarizeFindings(findings: Finding[]): { total: number; high: number; medium: number; low: number; verify: number } {
  const counts = { total: findings.length, high: 0, medium: 0, low: 0, verify: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
