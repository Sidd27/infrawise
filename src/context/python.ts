import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { ExtractedOperation } from '../types.js';
import { logger } from '../core/index.js';

const execFileAsync = promisify(execFile);
const SCANNER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scanner.py');

let cachedInterpreter: string | null | undefined;

async function findPythonInterpreter(): Promise<string | null> {
  if (cachedInterpreter !== undefined) return cachedInterpreter;
  for (const cmd of ['python3', 'python', 'py']) {
    try {
      await execFileAsync(cmd, ['--version']);
      cachedInterpreter = cmd;
      return cmd;
    } catch {
      // try next candidate
    }
  }
  cachedInterpreter = null;
  return null;
}

export async function scanPythonRepository(repoPath: string): Promise<ExtractedOperation[]> {
  const interpreter = await findPythonInterpreter();
  if (interpreter === null) {
    logger.warn('Python files found but no python3 on PATH — skipping Python scan');
    return [];
  }
  try {
    const { stdout } = await execFileAsync(interpreter, [SCANNER_PATH, repoPath], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(stdout) as ExtractedOperation[];
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
    logger.warn(`Python scan failed — skipping (${message})`);
    return [];
  }
}
