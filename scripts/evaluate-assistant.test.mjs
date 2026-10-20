import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateTrace } from './evaluate-assistant.mjs';
const scenarios = JSON.parse(
  readFileSync(new URL('../evals/scenarios.json', import.meta.url), 'utf8'),
);
it('rejects no-tool, incorrect-argument, and confidently incorrect answers', () => {
  expect(evaluateTrace(scenarios, []).every((result) => !result.passed)).toBe(true);
  const controls = scenarios.map((scenario) => ({
    id: scenario.id,
    calls: scenario.requiredTools.map((name) => ({
      name,
      arguments: scenario.requiredArguments?.[name] ?? {},
    })),
    facts: scenario.facts,
    evidence: 'Synthetic positive control; not a measured assistant run.',
  }));
  expect(evaluateTrace(scenarios, controls).every((result) => result.passed)).toBe(true);
  controls[0].calls[1].arguments = { tables: ['wrong'] };
  controls[2].facts = { absenceProven: true };
  expect(
    evaluateTrace(scenarios, controls)
      .filter((result) => !result.passed)
      .map((result) => result.id),
  ).toEqual(['schema-before-query', 'failed-source']);
});
