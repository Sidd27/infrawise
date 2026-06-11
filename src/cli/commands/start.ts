import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { readCache, setCacheDir, formatError, loadConfig } from '../../core/index.js';
import type { SystemGraph, Finding } from '../../types.js';
import { log, printHeader } from '../utils.js';
import { runInit } from './init.js';
import { runAnalyze } from './analyze.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface StartOptions {
  config?: string;
  claude?: boolean;
  cursor?: boolean;
}

function writeMcpJson(configAbsPath: string): void {
  const entry = {
    mcpServers: {
      infrawise: {
        command: 'infrawise',
        args: ['stdio', '--config', configAbsPath],
      },
    },
  };
  fs.writeFileSync('.mcp.json', JSON.stringify(entry, null, 2), 'utf-8');
  log.success('MCP config written', '.mcp.json');
}

function writeCursorMcp(configAbsPath: string): void {
  const dir = '.cursor';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const entry = {
    mcpServers: {
      infrawise: {
        command: 'infrawise',
        args: ['stdio', '--config', configAbsPath],
      },
    },
  };
  fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify(entry, null, 2), 'utf-8');
  log.success('Cursor config written', '.cursor/mcp.json');
}

function launchEditor(editor: 'claude' | 'cursor'): Promise<void> {
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
      console.log(chalk.dim('  Opening Cursor...'));
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

  // Step 1 — create infrawise.yaml if missing
  if (!fs.existsSync(configAbsPath)) {
    log.warn('No infrawise.yaml found — running setup...');
    console.log('');
    await runInit({ quiet: true });
    console.log('');
  }

  // Validate config is loadable before proceeding
  try {
    loadConfig(configPath);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }

  setCacheDir(path.dirname(configAbsPath));

  // Step 2 — check cache with 24h TTL, re-analyze if stale or missing
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

  // Step 3 — write editor MCP config files
  console.log('');
  writeMcpJson(configAbsPath);
  if (options.cursor) writeCursorMcp(configAbsPath);

  // Step 4 — launch editor or print instructions
  const editor = options.claude ? 'claude' : options.cursor ? 'cursor' : null;

  if (!editor) {
    console.log('');
    console.log(chalk.bold('  Setup complete — open your editor to start.'));
    console.log('');
    console.log(chalk.dim('  Claude Code:  claude'));
    console.log(chalk.dim('  Cursor:       cursor .'));
    console.log('');
    console.log(chalk.dim('  Next time just open your editor — no infrawise command needed.'));
    console.log('');
    return;
  }

  await launchEditor(editor);
}
