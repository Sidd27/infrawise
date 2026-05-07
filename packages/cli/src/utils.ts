import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Finding } from '@infrawise/shared';

export function readAWSProfiles(): string[] {
  const credentialsPath = path.join(os.homedir(), '.aws', 'credentials');
  const configPath = path.join(os.homedir(), '.aws', 'config');

  const profiles = new Set<string>();

  function parseProfiles(filePath: string, prefix = ''): void {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^\[(.+)\]$/);
      if (match?.[1]) {
        let name = match[1];
        if (name.startsWith('profile ')) name = name.slice(8);
        profiles.add(name);
      }
    }
  }

  parseProfiles(credentialsPath);
  parseProfiles(configPath);

  return profiles.size > 0 ? [...profiles] : ['default'];
}

export function detectAWSRegion(): string {
  // Check environment variables first
  if (process.env.AWS_DEFAULT_REGION) return process.env.AWS_DEFAULT_REGION;
  if (process.env.AWS_REGION) return process.env.AWS_REGION;

  // Try reading from config file
  const configPath = path.join(os.homedir(), '.aws', 'config');
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    const match = content.match(/region\s*=\s*(.+)/);
    if (match?.[1]) return match[1].trim();
  }

  return 'us-east-1';
}

export function detectRepoType(repoPath: string): 'typescript' | 'javascript' | 'unknown' {
  if (fs.existsSync(path.join(repoPath, 'tsconfig.json'))) return 'typescript';
  if (fs.existsSync(path.join(repoPath, 'package.json'))) return 'javascript';
  return 'unknown';
}

export function severityColor(severity: Finding['severity']): string {
  switch (severity) {
    case 'high':
      return '\x1b[31m'; // red
    case 'medium':
      return '\x1b[33m'; // yellow
    case 'low':
      return '\x1b[36m'; // cyan
    default:
      return '\x1b[0m';
  }
}

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const GREEN = '\x1b[32m';
export const RED = '\x1b[31m';
export const YELLOW = '\x1b[33m';
export const CYAN = '\x1b[36m';
export const BLUE = '\x1b[34m';

export function printBanner(): void {
  console.log(`${BOLD}${BLUE}`);
  console.log('  ___        __                  _          ');
  console.log(' |_ _|_ __  / _|_ __ __ ___      _(_)___  ___ ');
  console.log('  | || \'_ \\| |_| \'__/ _` \\ \\ /\\ / / / __|/ _ \\');
  console.log('  | || | | |  _| | | (_| |\\ V  V /| \\__ \\  __/');
  console.log(' |___|_| |_|_| |_|  \\__,_| \\_/\\_/ |_|___/\\___|');
  console.log(`${RESET}`);
  console.log(`${DIM}  Infrastructure Intelligence Platform v0.1.0${RESET}\n`);
}

export function printFinding(finding: Finding, index: number): void {
  const color = severityColor(finding.severity);
  const badge = `[${finding.severity.toUpperCase()}]`;

  console.log(`\n${BOLD}${index + 1}. ${color}${badge}${RESET} ${BOLD}${finding.issue}${RESET}`);
  console.log(`   ${DIM}${finding.description}${RESET}`);
  console.log(`   ${GREEN}Recommendation:${RESET} ${finding.recommendation}`);
}

export function printSummaryTable(findings: Finding[]): void {
  const high = findings.filter((f) => f.severity === 'high').length;
  const medium = findings.filter((f) => f.severity === 'medium').length;
  const low = findings.filter((f) => f.severity === 'low').length;

  console.log(`\n${BOLD}Summary${RESET}`);
  console.log('─'.repeat(40));
  console.log(`  Total Issues:  ${BOLD}${findings.length}${RESET}`);
  console.log(`  ${RED}High:${RESET}          ${high}`);
  console.log(`  ${YELLOW}Medium:${RESET}        ${medium}`);
  console.log(`  ${CYAN}Low:${RESET}           ${low}`);
  console.log('─'.repeat(40));
}
