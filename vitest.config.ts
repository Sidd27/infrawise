import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/cli/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 44,
        branches: 34,
        functions: 52,
        lines: 45,
      },
    },
  },
});
