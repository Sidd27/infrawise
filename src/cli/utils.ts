import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import type { Finding } from '../types';

// ─── AWS helpers ─────────────────────────────────────────────────────────────

export function readAWSProfiles(): string[] {
  const credentialsPath = path.join(os.homedir(), '.aws', 'credentials');
  const configPath = path.join(os.homedir(), '.aws', 'config');
  const profiles = new Set<string>();

  function parseFile(filePath: string): void {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
      const match = line.match(/^\[(.+)\]$/);
      if (match?.[1]) {
        let name = match[1];
        if (name.startsWith('profile ')) name = name.slice(8);
        profiles.add(name);
      }
    }
  }

  parseFile(credentialsPath);
  parseFile(configPath);
  return profiles.size > 0 ? [...profiles] : ['default'];
}

export function detectAWSRegion(): string {
  if (process.env.AWS_DEFAULT_REGION) return process.env.AWS_DEFAULT_REGION;
  if (process.env.AWS_REGION) return process.env.AWS_REGION;
  const configPath = path.join(os.homedir(), '.aws', 'config');
  if (fs.existsSync(configPath)) {
    const match = fs.readFileSync(configPath, 'utf-8').match(/region\s*=\s*(.+)/);
    if (match?.[1]) return match[1].trim();
  }
  return 'us-east-1';
}

export function detectRepoType(repoPath: string): 'typescript' | 'javascript' | 'unknown' {
  if (fs.existsSync(path.join(repoPath, 'tsconfig.json'))) return 'typescript';
  if (fs.existsSync(path.join(repoPath, 'package.json'))) return 'javascript';
  return 'unknown';
}

// ─── Banner ──────────────────────────────────────────────────────────────────

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
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
    console.log(`  ${chalk.red('✗')} ${chalk.red(msg)}${detail ? chalk.dim(`\n    ${detail}`) : ''}`);
  },
  warn: (msg: string, detail?: string) => {
    console.log(`  ${chalk.yellow('⚠')} ${chalk.yellow(msg)}${detail ? chalk.dim(`\n    ${detail}`) : ''}`);
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
    case 'high':   return chalk.bgRed.white.bold(` HIGH `);
    case 'medium': return chalk.bgYellow.black.bold(` MED  `);
    case 'low':    return chalk.bgCyan.black.bold(` LOW  `);
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
  const high   = findings.filter((f) => f.severity === 'high').length;
  const medium = findings.filter((f) => f.severity === 'medium').length;
  const low    = findings.filter((f) => f.severity === 'low').length;

  console.log('');
  console.log(chalk.dim('  ┌─────────────────────────────┐'));
  console.log(chalk.dim('  │') + chalk.bold('  Analysis Summary             ') + chalk.dim('│'));
  console.log(chalk.dim('  ├─────────────────────────────┤'));
  console.log(chalk.dim('  │') + `  ${chalk.red('●')} High     ${chalk.red.bold(String(high).padStart(3))}                 ` + chalk.dim('│'));
  console.log(chalk.dim('  │') + `  ${chalk.yellow('●')} Medium   ${chalk.yellow.bold(String(medium).padStart(3))}                 ` + chalk.dim('│'));
  console.log(chalk.dim('  │') + `  ${chalk.cyan('●')} Low      ${chalk.cyan.bold(String(low).padStart(3))}                 ` + chalk.dim('│'));
  console.log(chalk.dim('  ├─────────────────────────────┤'));
  console.log(chalk.dim('  │') + `  Total    ${chalk.bold(String(findings.length).padStart(3))}                 ` + chalk.dim('│'));
  console.log(chalk.dim('  └─────────────────────────────┘'));
}
