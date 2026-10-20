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
  allowIncomplete?: boolean;
}

export interface CheckEvaluation {
  violations: Finding[];
  failedSources: SourceStatus[];
  exitCode: 0 | 1 | 2;
}

export function evaluateCheck(
  findings: Finding[],
  failOn: 'high' | 'medium' | 'low' = 'high',
  sources: SourceStatus[] = [],
  allowIncomplete = false,
): CheckEvaluation {
  const threshold = SEVERITY_ORDER[failOn] ?? 3;
  const violations = findings.filter((f) => (SEVERITY_ORDER[f.severity] ?? 0) >= threshold);
  const failedSources = sources.filter((s) => s.status === 'failed' || s.status === 'partial');
  return {
    violations,
    failedSources,
    exitCode: violations.length ? 1 : failedSources.length && !allowIncomplete ? 2 : 0,
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

  const { violations, failedSources, exitCode } = evaluateCheck(
    findings,
    failOn,
    readCache<AnalysisProvenance>('provenance')?.sources ?? [],
    options.allowIncomplete,
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
    if (exitCode === 2) {
      log.fail(
        'Check incomplete',
        'required sources were not fully read; retry or explicitly use --allow-incomplete',
      );
      process.exit(2);
    }
    log.success(
      'Check passed',
      `no ${failOn}+ findings (${findings.length} total below threshold)` +
        (failedSources.length > 0
          ? ` — incomplete analysis explicitly allowed (${failedSources.length} source(s))`
          : ''),
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
