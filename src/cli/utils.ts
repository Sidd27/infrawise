import * as fs from 'fs';
import * as path from 'path';
import { stripVTControlCharacters } from 'util';
import { loadSharedConfigFiles, CONFIG_PREFIX_SEPARATOR } from '@smithy/shared-ini-file-loader';
import chalk from 'chalk';
import type { Finding } from '../types.js';

// ─── AWS helpers ─────────────────────────────────────────────────────────────

// These used to shell out to `aws configure`, which made the AWS CLI an
// undeclared runtime requirement: without it on PATH, discovery silently fell
// back to one profile and us-east-1 rather than reading the config that was
// sitting right there. This is the same ini loader the AWS SDK resolves
// credentials with, so it honours AWS_CONFIG_FILE and friends the same way.
async function sharedProfiles(): Promise<Record<string, Record<string, string | undefined>>> {
  try {
    const { configFile, credentialsFile } = await loadSharedConfigFiles();
    return { ...credentialsFile, ...configFile };
  } catch {
    return {};
  }
}

export async function readAWSProfiles(): Promise<string[]> {
  // Non-profile sections (sso-session, services) are namespaced with a
  // separator; `aws configure list-profiles` does not list them either.
  const profiles = Object.keys(await sharedProfiles()).filter(
    (name) => !name.includes(CONFIG_PREFIX_SEPARATOR),
  );
  return profiles.length > 0 ? profiles : ['default'];
}

export async function detectAWSRegion(profile?: string): Promise<string> {
  if (process.env.AWS_DEFAULT_REGION) return process.env.AWS_DEFAULT_REGION;
  if (process.env.AWS_REGION) return process.env.AWS_REGION;
  const target = profile ?? process.env.AWS_PROFILE ?? 'default';
  return (await sharedProfiles())[target]?.region ?? 'us-east-1';
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

const SEVERITIES = [
  ['High', 'high', chalk.red],
  ['Medium', 'medium', chalk.yellow],
  ['Low', 'low', chalk.cyan],
  ['Verify', 'verify', chalk.blue],
] as const;

// Pads on the uncolored width — chalk's escape codes make .length useless here.
export const boxRow = (s: string, width = BOX_WIDTH): string =>
  chalk.dim('  │') +
  s +
  ' '.repeat(Math.max(0, width - stripVTControlCharacters(s).length)) +
  chalk.dim('│');

export const rule = (l: string, r: string, width = BOX_WIDTH): string =>
  chalk.dim(`  ${l}${'─'.repeat(width)}${r}`);

export function printSummaryBox(findings: Finding[]): void {
  const pad = (n: number): string => String(n).padStart(3);

  console.log('');
  console.log(rule('┌', '┐'));
  console.log(boxRow(chalk.bold('  Analysis Summary')));
  console.log(rule('├', '┤'));
  for (const [label, severity, color] of SEVERITIES) {
    const n = findings.filter((f) => f.severity === severity).length;
    console.log(boxRow(`  ${color('●')} ${label.padEnd(9)}${color.bold(pad(n))}`));
  }
  console.log(rule('├', '┤'));
  console.log(boxRow(`  Total      ${chalk.bold(pad(findings.length))}`));
  console.log(rule('└', '┘'));
}
