# Assistant behavior evaluations

These scenarios measure whether an assistant consults infrastructure tools and handles uncertainty before writing code. Run each prompt in `scenarios.json` in a fresh editor conversation with Infrawise connected. Record the assistant/model version, tool calls, responses, generated answer, and elapsed time. Repeat the same tasks without Infrawise to compare correctness and time. Use demo fixtures and do not put account secrets in traces.

A reviewer normalizes each run into an array of entries with `id`, ordered `calls` (`name`, `arguments`), reviewed answer `facts`, and `evidence` containing the answer/tool-log excerpt or a local artifact reference. The expected facts and arguments are in each scenario. Score with `pnpm eval:assistant traces.json`. Missing scenarios, wrong arguments, wrong tool order, or incorrect answer facts fail. Review evidence yourself: the scorer cannot prove that self-reported facts match the generated prose.

The automated tests exercise positive and negative controls for the scorer. They are not evidence that a particular model uses the tools reliably. No real-model adoption score is claimed until actual runs are collected.

Each scenario names its required fixture. For the missing-column task, a correct answer must not generate SQL against the nonexistent `customer_id` column on the seeded `orders` table. For the outage task, use a temporary config on a closed port and analyze first so source health records the failure. For staleness, use a disposable snapshot whose provenance time is older than the requested tolerance but within the cache TTL. Never modify production snapshots for tests.

The report separates tool-use compliance from reviewed answer-fact correctness. A no-MCP baseline can have correct answer facts while failing tool-use checks; compare those dimensions separately. Record real model identity, prompts, artifacts and reviewer judgments before reporting quality scores.
