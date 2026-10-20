# Infrastructure-aware coding workflow

Copy these instructions into the coding assistant instructions for the application using Infrawise:

1. At the start of an infrastructure task, call `get_infra_overview`. Read `dataHealth.sources`, snapshot age, and code coverage before drawing conclusions. Failed/partial sources and unresolved references are uncertainty, not proof of absence.
2. Before writing SQL, DynamoDB expressions, or MongoDB filters, request only the relevant tables with `get_table_schema`. Use observed column/key/index names. Ordered relational index columns describe potential access paths, not measured query plans; ask for EXPLAIN when necessary.
3. Before writing a Lambda handler, call `analyze_function` with both `function` and `file`. Use the returned trigger event shape and permission evidence. Resolve ambiguous attribution rather than selecting a candidate silently.
4. Before SNS publishes or SQS producers/consumers, inspect `get_topic_details` or `get_queue_details` for filter attributes, FIFO requirements, timeouts, and DLQs.
5. For “right now” claims pass `maxAgeSeconds`, inspect `withinRequestedAge`, and date the answer. If data is too old, say so and use `infrawise analyze` after approval when execution is appropriate. Do not describe snapshot age as verified deployment state.
6. Static scanning is not complete runtime coverage. State unresolved references and unsupported expressions; an empty access list does not prove a function touches no infrastructure.
7. Use `get_log_errors` for log group retention metadata only. Error frequency is not observed and message bodies are not read.

Validate assistant compliance and answer correctness with the prompts and trace scorer in `evals/`. Prompt instructions improve the opportunity for correct tool use; they cannot guarantee model behavior.
