import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';

export function probePort(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const cleanup = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => cleanup(true));
    socket.on('timeout', () => cleanup(false));
    socket.on('error', () => cleanup(false));
    socket.connect(port, host);
  });
}

export function scanDotEnv(cwd: string): Record<string, string> {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return {};
  const result: Record<string, string> = {};
  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      result[key] = value;
    }
  } catch {
    // silent — non-critical
  }
  return result;
}
