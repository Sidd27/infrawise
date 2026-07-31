import { SEVERITY_ORDER, type Analyzer, type SystemGraph, type Finding } from '../types.js';
import { logger } from '../core/index.js';

export * from './dynamodb.js';
export * from './postgres.js';
export * from './mysql.js';
export * from './mongodb.js';
export * from './terraform.js';
export * from './pipeline.js';
export * from './aws-services.js';
export * from './rds.js';
export * from './cost-signals.js';

export async function runAllAnalyzers(
  graph: SystemGraph,
  analyzers: Analyzer[],
): Promise<Finding[]> {
  const allFindings: Finding[] = [];

  for (const analyzer of analyzers) {
    try {
      logger.debug(`Running analyzer: ${analyzer.name}`);
      const findings = await analyzer(graph);
      logger.debug(`[${analyzer.name}] found ${findings.length} issue(s)`);
      allFindings.push(...findings);
    } catch (err) {
      logger.warn(
        `Analyzer "${analyzer.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  allFindings.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
  return allFindings;
}

export function summarizeFindings(findings: Finding[]): {
  total: number;
  high: number;
  medium: number;
  low: number;
  verify: number;
} {
  const counts = { total: findings.length, high: 0, medium: 0, low: 0, verify: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
