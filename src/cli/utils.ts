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

const BOX_WIDTH = 29;

// Pads on the uncolored text — chalk's escape codes make .length useless here.
function boxRow(plain: string, styled: string): string {
  return (
    chalk.dim('  │') +
    styled +
    ' '.repeat(Math.max(0, BOX_WIDTH - [...plain].length)) +
    chalk.dim('│')
  );
}

export function printSummaryBox(findings: Finding[]): void {
  const count = (severity: Finding['severity']): string =>
    String(findings.filter((f) => f.severity === severity).length).padStart(3);

  const severityRow = (
    label: string,
    n: string,
    color: (s: string) => string,
    boldColor: (s: string) => string,
  ): string => boxRow(`  ● ${label}${n}`, `  ${color('●')} ${label}${boldColor(n)}`);

  const rule = (l: string, r: string): string => chalk.dim(`  ${l}${'─'.repeat(BOX_WIDTH)}${r}`);

  console.log('');
  console.log(rule('┌', '┐'));
  console.log(boxRow('  Analysis Summary', chalk.bold('  Analysis Summary')));
  console.log(rule('├', '┤'));
  console.log(severityRow('High     ', count('high'), chalk.red, chalk.red.bold));
  console.log(severityRow('Medium   ', count('medium'), chalk.yellow, chalk.yellow.bold));
  console.log(severityRow('Low      ', count('low'), chalk.cyan, chalk.cyan.bold));
  console.log(severityRow('Verify   ', count('verify'), chalk.blue, chalk.blue.bold));
  console.log(rule('├', '┤'));
  console.log(
    boxRow(
      `  Total      ${String(findings.length).padStart(3)}`,
      `  Total      ${chalk.bold(String(findings.length).padStart(3))}`,
    ),
  );
  console.log(rule('└', '┘'));
}
