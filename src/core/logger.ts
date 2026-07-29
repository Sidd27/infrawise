import pino from 'pino';

// Everything goes to stderr: `serve --stdio` reserves stdout for MCP JSON-RPC,
// and a log line on stdout corrupts the frame stream.
const STDERR_FD = 2;

function createLogger() {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  if (isDevelopment) {
    return pino({
      level: process.env.LOG_LEVEL ?? 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          messageFormat: '{msg}',
          destination: STDERR_FD,
        },
      },
    });
  }

  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    pino.destination(STDERR_FD),
  );
}

export const logger = createLogger();

export type Logger = typeof logger;
