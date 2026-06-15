import { runDev } from './dev.js';
import { runStdio } from './stdio.js';

interface ServeOptions {
  config?: string;
  stdio?: boolean;
  port?: number;
}

export async function runServe(options: ServeOptions = {}): Promise<void> {
  if (options.stdio) {
    await runStdio(options.config);
    return;
  }
  await runDev({ config: options.config, port: options.port });
}
