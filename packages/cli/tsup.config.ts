import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  minify: false,
  sourcemap: false,
  splitting: false,
  // Bundle all @infrawise/* workspace packages into the output
  noExternal: [/@infrawise\/.*/],
  // Keep all real npm deps as external — they stay in node_modules
  external: [
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/credential-providers',
    '@fastify/cors',
    'chalk',
    'commander',
    'fastify',
    'inquirer',
    'js-yaml',
    'mongodb',
    'mysql2',
    'ora',
    'pg',
    'pino',
    'pino-pretty',
    'ts-morph',
    'typescript',
    'zod',
  ],
});
