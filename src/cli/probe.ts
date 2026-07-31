import * as net from 'net';
import { parseEnv } from 'util';
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
  try {
    return parseEnv(fs.readFileSync(envPath, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}
