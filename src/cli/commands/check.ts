import * as path from 'path';
import chalk from 'chalk';
import { readCache, setCacheDir } from '../../core/index.js';

import { SEVERITY_ORDER, type Finding, type AnalysisProvenance } from '../../types.js';
import { printFinding, log, printHeader } from '../utils.js';
import { runAnalyze } from './analyze.js';

interface CheckOptions {
  config?: string;
  repo?: string;
  failOn?: 'high' | 'medium' | 'low';
}

export async function runCheck(options: CheckOptions = {}): Promise<void> {
  const failOn = options.failOn ?? 'high';
  const threshold = SEVERITY_ORDER[failOn] ?? 3;

  printHeader('Infrawise Check');

  // Always extract fresh — CI must not gate on a stale graph.
  await runAnalyze({ config: options.config, repo: options.repo, silent: true });

  setCacheDir(path.dirname(path.resolve(options.config ?? 'infrawise.yaml')));
  // 24h, matching the graph cache. On readCache's 1h default an analysis that
  // took longer than an hour read back as no findings — a green CI gate meaning
  // "nothing was read" rather than "nothing is wrong".
  const findings = readCache<Finding[]>('findings') ?? [];

  const violations = findings.filter((f) => (SEVERITY_ORDER[f.severity] ?? 0) >= threshold);

  // A source that failed to extract produces no findings, which is not the same
  // as producing no problems. Say so before any pass/fail line, so a green check
  // on half-read infrastructure cannot be mistaken for a clean one.
  const failedSources = (readCache<AnalysisProvenance>('provenance')?.sources ?? []).filter(
    (s) => s.status === 'failed',
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
