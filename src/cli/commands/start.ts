import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { readCache, setCacheDir, formatError, loadConfig } from '../../core/index.js';
import type { SystemGraph, Finding } from '../../types.js';
import { log, printHeader } from '../utils.js';
import { runDiscover } from './discover.js';
import { runAnalyze } from './analyze.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface StartOptions {
  config?: string;
  claude?: boolean;
  cursor?: boolean;
  vscode?: boolean;
  interactive?: boolean;
  rediscover?: boolean;
}

export function writeMcpConfig(
  configAbsPath: string,
  file: string,
  label: string,
  key: 'servers' | 'mcpServers' = 'mcpServers',
): void {
  const dir = path.dirname(file);
  if (dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const entry = {
    [key]: {
      infrawise: {
        ...(key === 'servers' ? { type: 'stdio' } : {}),
        command: 'infrawise',
        args: ['serve', '--stdio', '--config', configAbsPath],
      },
    },
  };
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf-8');
  log.success(`${label} config written`, file);
}

export const writeVscodeMcp = (configAbsPath: string): void =>
  writeMcpConfig(configAbsPath, path.join('.vscode', 'mcp.json'), 'VS Code', 'servers');

function launchEditor(editor: 'claude' | 'cursor' | 'code'): Promise<void> {
  return new Promise((resolve) => {
    if (editor === 'claude') {
      console.log('');
      console.log(chalk.dim('  Starting Claude Code...'));
      console.log('');
      const child = spawn('claude', [], { stdio: 'inherit' });
      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          console.error(chalk.red('\n  Error: claude CLI not found.'));
          console.error(chalk.dim('  Install it from https://claude.ai/code\n'));
        }
        resolve();
      });
      child.on('exit', () => resolve());
    } else {
      const cmd = editor;
      const args = ['.'];
      console.log('');
      console.log(chalk.dim(`  Opening ${cmd}...`));
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          console.error(chalk.red(`\n  Error: ${cmd} CLI not found. Open it manually.\n`));
        }
      });
      child.unref();
      resolve();
    }
  });
}

export async function runStart(options: StartOptions = {}): Promise<void> {
  printHeader('Infrawise');

  const cwd = process.cwd();
  const configPath = options.config ?? 'infrawise.yaml';
  const configAbsPath = path.resolve(cwd, configPath);

  // --rediscover: wipe yaml + entire .infrawise dir, then re-run discovery and analysis
  if (options.rediscover) {
    if (fs.existsSync(configAbsPath)) {
      fs.unlinkSync(configAbsPath);
    }
    const infrawiseDir = path.join(path.dirname(configAbsPath), '.infrawise');
    if (fs.existsSync(infrawiseDir)) {
      fs.rmSync(infrawiseDir, { recursive: true, force: true });
    }
    log.warn('Cleared config and .infrawise — rediscovering...');
    console.log('');
  }

  // Generate config if missing
  if (!fs.existsSync(configAbsPath)) {
    log.warn('No infrawise.yaml found — probing environment...');
    console.log('');
    await runDiscover({ interactive: options.interactive });
    console.log('');
  }

  // Validate config
  try {
    loadConfig(configAbsPath);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }

  setCacheDir(path.dirname(configAbsPath));

  // Check cache, re-analyze if stale
  const cachedGraph = readCache<SystemGraph>('graph', CACHE_TTL_MS);
  const cachedFindings = readCache<Finding[]>('findings', CACHE_TTL_MS);

  if (cachedGraph && cachedFindings) {
    log.success(
      'Analysis loaded from cache',
      `${cachedGraph.nodes.length} nodes · ${cachedGraph.edges.length} edges · ${cachedFindings.length} finding(s)`,
    );
  } else {
    const reason = (cachedGraph ?? cachedFindings) ? 'Cache is stale (>24h)' : 'No cache found';
    log.warn(`${reason} — running analysis...`);
    console.log('');
    await runAnalyze({ config: options.config, silent: true });
    console.log('');
  }

  // Write editor MCP config files
  console.log('');
  writeMcpConfig(configAbsPath, '.mcp.json', 'MCP');
  if (options.cursor) writeMcpConfig(configAbsPath, path.join('.cursor', 'mcp.json'), 'Cursor');
  if (options.vscode) writeVscodeMcp(configAbsPath);

  // Launch editor or print instructions
  const editor = options.claude
    ? 'claude'
    : options.cursor
      ? 'cursor'
      : options.vscode
        ? 'code'
        : null;

  if (!editor) {
    console.log('');
    console.log(chalk.bold('  Setup complete — open your editor to start.'));
    console.log('');
    console.log(chalk.dim('  Claude Code:  claude'));
    console.log(chalk.dim('  Cursor:       cursor .'));
    console.log(chalk.dim('  VS Code:      code .'));
    console.log('');
    console.log(chalk.dim('  Next time just open your editor — no infrawise command needed.'));
    console.log('');
    return;
  }

  await launchEditor(editor);
}
