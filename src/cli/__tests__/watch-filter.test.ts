import { describe, it, expect } from 'vitest';
import { isConfigFile, triggersRefresh } from '../mcp-boot.js';

describe('isConfigFile', () => {
  it('matches the configured file however the caller spelled it', () => {
    expect(isConfigFile('/repo', 'infrawise.yaml', '/repo/infrawise.yaml')).toBe(true);
    expect(isConfigFile(process.cwd(), 'infrawise.yaml', 'infrawise.yaml')).toBe(true);
    expect(isConfigFile('/repo', 'config/custom.yaml', '/repo/config/custom.yaml')).toBe(true);
  });

  it('leaves neighbours alone', () => {
    expect(isConfigFile('/repo', 'orders.ts', '/repo/infrawise.yaml')).toBe(false);
    expect(isConfigFile('/repo', 'src/infrawise.yaml', '/repo/infrawise.yaml')).toBe(false);
    expect(isConfigFile('/repo', 'infrawise.yaml.bak', '/repo/infrawise.yaml')).toBe(false);
  });
});

describe('triggersRefresh', () => {
  it('refreshes on source files', () => {
    expect(triggersRefresh('src/handlers/orders.ts')).toBe(true);
    expect(triggersRefresh('app.mjs')).toBe(true);
    expect(triggersRefresh('handlers/orders.py')).toBe(true);
    expect(triggersRefresh('tsconfig.json')).toBe(true);
  });

  it('ignores non-source files', () => {
    expect(triggersRefresh('cdk.out/AppStack.template.json')).toBe(false);
    expect(triggersRefresh('README.md')).toBe(false);
  });

  it('ignores build output and vendored trees', () => {
    expect(triggersRefresh('cdk.out/asset.abc123/index.js')).toBe(false);
    expect(triggersRefresh('dist/index.js')).toBe(false);
    expect(triggersRefresh('packages/api/node_modules/foo/index.js')).toBe(false);
    expect(triggersRefresh('.venv/lib/thing.js')).toBe(false);
  });
});
