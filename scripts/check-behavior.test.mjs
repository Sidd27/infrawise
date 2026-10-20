import { expect, it } from 'vitest';
import { behaviorErrors } from './check-behavior.mjs';
it('rejects missing response fields and obsolete behavior claims', () => {
  const docs = Object.fromEntries(
    [
      'README.md',
      'AGENTS.md',
      'llms.txt',
      'website/src/content/docs/reference/cli.md',
      'website/src/content/docs/reference/mcp-tools.md',
    ].map((name) => [name, '--allow-incomplete exit 2 errorsObserved']),
  );
  docs['website/src/content/docs/reference/data-freshness.md'] = '`ageSeconds`';
  expect(behaviorErrors('const response = { dataHealth: { ageSeconds: 1 } };', docs)).toEqual([]);
  docs['README.md'] += ' analysis.severity';
  expect(
    behaviorErrors('const response = { dataHealth: { ageSeconds: 1, newField: 2 } };', docs),
  ).toEqual(
    expect.arrayContaining([
      'Data freshness reference omits newField',
      'README.md: obsolete public behavior claim',
    ]),
  );
});
