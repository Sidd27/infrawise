import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function evaluateTrace(scenarios, traces) {
  return scenarios.map((scenario) => {
    const trace = traces.find((entry) => entry.id === scenario.id);
    const failures = [];
    let after = -1;
    for (const tool of scenario.requiredTools) {
      const index =
        trace?.calls?.findIndex((call, position) => position > after && call.name === tool) ?? -1;
      if (index < 0) {
        failures.push(`Missing or out-of-order tool: ${tool}`);
        continue;
      }
      after = index;
      for (const [key, expected] of Object.entries(scenario.requiredArguments?.[tool] ?? {})) {
        const actual = trace.calls[index].arguments?.[key];
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          failures.push(`${tool}.${key} differs from expected`);
      }
    }
    const toolUsePassed = failures.length === 0;
    const factFailures = [];
    for (const [key, value] of Object.entries(scenario.facts)) {
      if (trace?.facts?.[key] !== value)
        factFailures.push(`Incorrect or missing answer fact: ${key}`);
    }
    failures.push(...factFailures);
    if (!trace?.evidence?.trim())
      failures.push('Missing answer/tool-log evidence for reviewer verification');
    return {
      id: scenario.id,
      passed: failures.length === 0,
      toolUsePassed,
      answerFactsPassed: factFailures.length === 0,
      failures,
    };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('Usage: pnpm eval:assistant path/to/reviewed-traces.json');
    process.exit(2);
  }
  const scenarios = JSON.parse(
    readFileSync(new URL('../evals/scenarios.json', import.meta.url), 'utf8'),
  );
  const traces = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
  const results = evaluateTrace(scenarios, traces);
  console.log(
    JSON.stringify(
      {
        passed: results.filter((result) => result.passed).length,
        toolUsePassed: results.filter((result) => result.toolUsePassed).length,
        answerFactsPassed: results.filter((result) => result.answerFactsPassed).length,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
