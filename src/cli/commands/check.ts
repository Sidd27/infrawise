import * as path from 'path';
import chalk from 'chalk';
import { readCache, setCacheDir } from '../../core/index.js';
import type { Finding } from '../../types.js';
import { printFinding, log, printHeader } from '../utils.js';
import { runAnalyze } from './analyze.js';

interface CheckOptions {
  config?: string;
  repo?: string;
  failOn?: 'high' | 'medium' | 'low';
}

const SEVERITY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1, verify: 0 };

export async function runCheck(options: CheckOptions = {}): Promise<void> {
  const failOn = options.failOn ?? 'high';
  const threshold = SEVERITY_ORDER[failOn] ?? 3;

  printHeader('Infrawise Check');

  // Always extract fresh — CI must not gate on a stale graph.
  await runAnalyze({ config: options.config, repo: options.repo, silent: true });

  setCacheDir(path.dirname(path.resolve(options.config ?? 'infrawise.yaml')));
  const findings = readCache<Finding[]>('findings') ?? [];

  const violations = findings.filter((f) => (SEVERITY_ORDER[f.severity] ?? 0) >= threshold);

  console.log('');
  if (violations.length === 0) {
    log.success(
      'Check passed',
      `no ${failOn}+ findings (${findings.length} total below threshold)`,
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
