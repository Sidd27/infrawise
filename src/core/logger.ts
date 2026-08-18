import { styleText } from 'util';

// Everything goes to stderr: `serve --stdio` reserves stdout for MCP JSON-RPC,
// and a log line on stdout corrupts the frame stream.

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;

type Level = keyof typeof LEVELS;

// hasOwn, not a plain lookup: LOG_LEVEL=constructor would otherwise resolve to
// Object off the prototype chain, and every `LEVELS[level] < threshold` compare
// against a function is false, silently turning on trace output.
const requested = process.env.LOG_LEVEL ?? '';
const threshold = Object.hasOwn(LEVELS, requested) ? LEVELS[requested as Level] : LEVELS.info;
const pretty = process.env.NODE_ENV !== 'production';

const COLORS: Record<Level, Parameters<typeof styleText>[0]> = {
  trace: 'gray',
  debug: 'blue',
  info: 'green',
  warn: 'yellow',
  error: 'red',
  fatal: 'magenta',
};

function emit(level: Level, msg: string): void {
  if (LEVELS[level] < threshold) return;
  if (!pretty) {
    process.stderr.write(`${JSON.stringify({ level: LEVELS[level], time: Date.now(), msg })}\n`);
    return;
  }
  // styleText validates against stdout unless told otherwise, and this writes to
  // stderr — without the stream it would colour by the wrong pipe's TTY state.
  const paint = (color: Parameters<typeof styleText>[0], text: string) =>
    styleText(color, text, { stream: process.stderr });
  const time = new Date().toTimeString().slice(0, 8);
  process.stderr.write(
    `[${time}] ${paint(COLORS[level], level.toUpperCase())}: ${paint('cyan', msg)}\n`,
  );
}

export const logger = {
  trace: (msg: string) => emit('trace', msg),
  debug: (msg: string) => emit('debug', msg),
  info: (msg: string) => emit('info', msg),
  warn: (msg: string) => emit('warn', msg),
  error: (msg: string) => emit('error', msg),
  fatal: (msg: string) => emit('fatal', msg),
};

export type Logger = typeof logger;
