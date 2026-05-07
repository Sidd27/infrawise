import pino from 'pino';

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
        },
      },
    });
  }

  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
  });
}

export const logger = createLogger();

export type Logger = typeof logger;
