import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import type { Finding } from '../types.js';

// ─── AWS helpers ─────────────────────────────────────────────────────────────

export function readAWSProfiles(): string[] {
  try {
    const out = execSync('aws configure list-profiles', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const profiles = out.trim().split('\n').filter(Boolean);
    return profiles.length > 0 ? profiles : ['default'];
  } catch {
    return ['default'];
  }
}

export function detectAWSRegion(profile?: string): string {
  if (process.env.AWS_DEFAULT_REGION) return process.env.AWS_DEFAULT_REGION;
  if (process.env.AWS_REGION) return process.env.AWS_REGION;
  const target = profile ?? process.env.AWS_PROFILE ?? 'default';
  try {
    const region = execSync(`aws configure get region --profile ${target}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (region) return region;
  } catch {
    // profile may not have region configured
  }
  return 'us-east-1';
}

// ─── Banner ──────────────────────────────────────────────────────────────────

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf-8'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

export function printBanner(): void {
  const line1 = chalk.bold.hex('#6366f1')('  infrawise');
  const version = chalk.dim(` v${readVersion()}`);
  const tagline = chalk.dim('  Infrastructure Intelligence Platform\n');
  console.log(`\n${line1}${version}`);
  console.log(tagline);
}

// ─── Section header ──────────────────────────────────────────────────────────

export function printHeader(title: string): void {
  console.log(chalk.bold(`\n${title}`));
  console.log(chalk.dim('─'.repeat(title.length + 2)));
}

// ─── Status lines ────────────────────────────────────────────────────────────

export const log = {
  success: (msg: string, detail?: string) => {
    console.log(`  ${chalk.green('✓')} ${msg}${detail ? chalk.dim(`  ${detail}`) : ''}`);
  },
  fail: (msg: string, detail?: string) => {
    console.log(
      `  ${chalk.red('✗')} ${chalk.red(msg)}${detail ? chalk.dim(`\n    ${detail}`) : ''}`,
    );
  },
  warn: (msg: string, detail?: string) => {
    console.log(
      `  ${chalk.yellow('⚠')} ${chalk.yellow(msg)}${detail ? chalk.dim(`\n    ${detail}`) : ''}`,
    );
  },
  skip: (msg: string, detail?: string) => {
    console.log(`  ${chalk.dim('−')} ${chalk.dim(msg)}${detail ? chalk.dim(`  ${detail}`) : ''}`);
  },
  info: (msg: string) => {
    console.log(`  ${chalk.cyan('›')} ${msg}`);
  },
  dim: (msg: string) => {
    console.log(chalk.dim(`  ${msg}`));
  },
};

// ─── Findings ────────────────────────────────────────────────────────────────

function severityBadge(severity: Finding['severity']): string {
  switch (severity) {
    case 'high':
      return chalk.bgRed.white.bold(` HIGH `);
    case 'medium':
      return chalk.bgYellow.black.bold(` MED  `);
    case 'low':
      return chalk.bgCyan.black.bold(` LOW  `);
    case 'verify':
      return chalk.bgBlue.white.bold(` VER? `);
  }
}

export function printFinding(finding: Finding, index: number): void {
  const badge = severityBadge(finding.severity);
  const num = chalk.dim(`${index + 1}.`);

  console.log(`\n  ${num} ${badge}  ${chalk.bold(finding.issue)}`);
  console.log(chalk.dim(`       ${finding.description}`));
  console.log(`       ${chalk.green('→')} ${finding.recommendation}`);
}

export function printSummaryBox(findings: Finding[]): void {
  const high = findings.filter((f) => f.severity === 'high').length;
  const medium = findings.filter((f) => f.severity === 'medium').length;
  const low = findings.filter((f) => f.severity === 'low').length;
  const verify = findings.filter((f) => f.severity === 'verify').length;

  console.log('');
  console.log(chalk.dim('  ┌─────────────────────────────┐'));
  console.log(chalk.dim('  │') + chalk.bold('  Analysis Summary             ') + chalk.dim('│'));
  console.log(chalk.dim('  ├─────────────────────────────┤'));
  console.log(
    chalk.dim('  │') +
      `  ${chalk.red('●')} High     ${chalk.red.bold(String(high).padStart(3))}                 ` +
      chalk.dim('│'),
  );
  console.log(
    chalk.dim('  │') +
      `  ${chalk.yellow('●')} Medium   ${chalk.yellow.bold(String(medium).padStart(3))}                 ` +
      chalk.dim('│'),
  );
  console.log(
    chalk.dim('  │') +
      `  ${chalk.cyan('●')} Low      ${chalk.cyan.bold(String(low).padStart(3))}                 ` +
      chalk.dim('│'),
  );
  console.log(
    chalk.dim('  │') +
      `  ${chalk.blue('●')} Verify   ${chalk.blue.bold(String(verify).padStart(3))}                 ` +
      chalk.dim('│'),
  );
  console.log(chalk.dim('  ├─────────────────────────────┤'));
  console.log(
    chalk.dim('  │') +
      `  Total    ${chalk.bold(String(findings.length).padStart(3))}                 ` +
      chalk.dim('│'),
  );
  console.log(chalk.dim('  └─────────────────────────────┘'));
}
