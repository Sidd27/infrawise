import { describe, it, expect } from 'vitest';
import { triggersRefresh } from '../mcp-boot.js';

describe('triggersRefresh', () => {
  it('refreshes on source files', () => {
    expect(triggersRefresh('src/handlers/orders.ts')).toBe(true);
    expect(triggersRefresh('app.mjs')).toBe(true);
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
