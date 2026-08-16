import * as path from 'path';
import chalk from 'chalk';
import { readCache, setCacheDir } from '../../core/index.js';

import {
  SEVERITY_ORDER,
  type Finding,
  type AnalysisProvenance,
  type SourceStatus,
} from '../../types.js';
import { printFinding, log, printHeader } from '../utils.js';
import { runAnalyze } from './analyze.js';

interface CheckOptions {
  config?: string;
  repo?: string;
  failOn?: 'high' | 'medium' | 'low';
}

export interface CheckEvaluation {
  violations: Finding[];
  failedSources: SourceStatus[];
}

export function evaluateCheck(
  findings: Finding[],
  failOn: 'high' | 'medium' | 'low' = 'high',
  sources: SourceStatus[] = [],
): CheckEvaluation {
  const threshold = SEVERITY_ORDER[failOn] ?? 3;
  return {
    violations: findings.filter((f) => (SEVERITY_ORDER[f.severity] ?? 0) >= threshold),
    failedSources: sources.filter((s) => s.status === 'failed'),
  };
}

export async function runCheck(options: CheckOptions = {}): Promise<void> {
  const failOn = options.failOn ?? 'high';

  printHeader('Infrawise Check');

  // Always extract fresh — CI must not gate on a stale graph.
  await runAnalyze({ config: options.config, repo: options.repo, silent: true });

  setCacheDir(path.dirname(path.resolve(options.config ?? 'infrawise.yaml')));
  // 24h, matching the graph cache. On readCache's 1h default an analysis that
  // took longer than an hour read back as no findings — a green CI gate meaning
  // "nothing was read" rather than "nothing is wrong".
  const findings = readCache<Finding[]>('findings') ?? [];

  const { violations, failedSources } = evaluateCheck(
    findings,
    failOn,
    readCache<AnalysisProvenance>('provenance')?.sources ?? [],
  );
  if (failedSources.length > 0) {
    console.log('');
    log.warn(
      'Incomplete analysis',
      `${failedSources.length} source(s) failed to extract — findings below do not cover them`,
    );
    for (const s of failedSources) log.warn(`  ${s.service}`, s.error ?? 'extraction failed');
  }

  console.log('');
  if (violations.length === 0) {
    log.success(
      'Check passed',
      `no ${failOn}+ findings (${findings.length} total below threshold)` +
        (failedSources.length > 0 ? ` — but ${failedSources.length} source(s) went unread` : ''),
    );
    console.log('');
    return;
  }

  console.log(
    chalk.bold('  Blocking findings') + chalk.dim(`  ${violations.length} at or above ${failOn}`),
  );
  violations.forEach((f, i) => printFinding(f, i));

  console.log('');
  log.fail(
    `Check failed`,
    `${violations.length} ${failOn}+ finding(s) must be resolved before deploy`,
  );
  console.log('');
  process.exit(1);
}
