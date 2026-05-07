import type { Analyzer, SystemGraph, Finding } from '@infrawise/shared';
import { logger } from '@infrawise/core';
import { FullTableScanAnalyzer, MissingGSIAnalyzer, HotPartitionAnalyzer } from './dynamodb';
import { MissingIndexAnalyzer, NplusOneAnalyzer, LargeSelectAnalyzer } from './postgres';

export { FullTableScanAnalyzer, MissingGSIAnalyzer, HotPartitionAnalyzer } from './dynamodb';
export { MissingIndexAnalyzer, NplusOneAnalyzer, LargeSelectAnalyzer } from './postgres';

const DEFAULT_ANALYZERS: Analyzer[] = [
  new FullTableScanAnalyzer(),
  new MissingGSIAnalyzer(),
  new HotPartitionAnalyzer(),
  new MissingIndexAnalyzer(),
  new NplusOneAnalyzer(),
  new LargeSelectAnalyzer(),
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
      logger.info(`[${analyzer.name}] found ${findings.length} issue(s)`);
      allFindings.push(...findings);
    } catch (err) {
      logger.warn(
        `Analyzer "${analyzer.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Sort findings by severity: high -> medium -> low
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
