# Synthetic `cdk.out`

Checked in on purpose — no `cdk synth` needed to run the demo.

`manifest.json` lists only `PaymentsStack`, exactly as `cdk synth` writes it for
an app that instantiates one stack. `LegacyBillingStack.template.json` has no
matching entry: it is the artifact a deleted or renamed stack leaves behind.

infrawise excludes the orphan's resources (`LegacyInvoicesTable`,
`legacy-billing-queue` never reach the graph or the drift analyzer) and keeps its
output flagged, so `get_stack_outputs` shows `demo-legacy-invoices-table-arn`
with `stale: true` and a reason. Delete `manifest.json` to see both stacks
treated as current — with no manifest, no cross-check is possible.
