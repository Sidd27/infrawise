---
title: Detecting IaC drift — resources that live outside your Terraform
description: Infrawise compares your live AWS account against your Terraform, CDK, or CloudFormation definitions and flags resources that were created manually or never deployed.
---

IaC drift happens when your AWS account and your infrastructure code fall out of sync. A DynamoDB table created manually in the console, a Lambda deployed via CLI one time and forgotten, an SQS queue defined in Terraform but never applied — none of these show up as errors in your codebase. They silently exist as discrepancies that cause incidents during disaster recovery, environment replication, or compliance audits.

Infrawise compares your live AWS account against your local Terraform, CDK, or CloudFormation definitions and surfaces the gap as findings.

## What Infrawise detects

Infrawise runs its IaC drift analyzer across three resource types: DynamoDB tables, SQS queues, and Lambda functions. For each type it checks two directions:

**Defined in IaC but not deployed — medium severity**

A resource exists in your Terraform (or CDK/CloudFormation) files but is not found in the live AWS account. It may have never been applied, been deleted manually after deployment, or exist only in a feature branch that was never merged.

**Deployed but not in IaC — medium severity for DynamoDB, low for SQS and Lambda**

A resource exists in AWS but has no matching definition in your IaC files. It was created manually — through the console, CLI, or a one-off script — and has never been brought under version control. These resources cannot be audited, reproduced in another environment, or safely modified via IaC without first importing them.

## Supported IaC tools

Infrawise reads local IaC files from your project directory. It supports:

- **Terraform** — `.tf` files
- **AWS CDK** — synthesized output
- **CloudFormation** — `.yaml` and `.json` template files

Configure the IaC path in `infrawise.yaml` under the `iac` section.

## How to use it

**See all drift findings:**

```
get_infra_overview()
```

IaC drift findings appear alongside other findings. High and medium severity findings are included in the overview response.

**Get the full graph including drift:**

```
get_graph_summary()
```

Returns all findings at every severity level, including low-severity "deployed but not in IaC" findings for SQS queues and Lambda functions.

## Practical example

You're adding a new SQS consumer Lambda. You call `get_infra_overview()` and see:

- `IaC drift: SQS queue "orders-retry" deployed but not in IaC`
- `IaC drift: Lambda "processRefund" deployed but not in IaC`

These two resources exist in your AWS account but have no Terraform definition. Before Claude Code writes code that references them, you know they need to be imported — otherwise `terraform destroy` on the next environment will delete them, and your code will reference queues and functions that don't exist in staging.

---

## FAQ

### Does Infrawise modify my Terraform files?

No. Infrawise only reads your IaC files. It generates findings identifying drift but never writes to your infrastructure or IaC definitions.

### What if I intentionally deploy resources outside IaC?

Infrawise will flag them as "deployed but not in IaC" at low or medium severity. You can treat these as expected if your workflow intentionally mixes manual and IaC-managed resources. The finding is informational — it doesn't block anything.

### Does Infrawise detect configuration drift, not just resource existence?

Currently Infrawise detects existence drift — whether resources exist in both places or only one. It does not compare configuration properties (like memory size or queue visibility timeout) between IaC definitions and live values.

### Which Terraform resources does Infrawise parse?

Infrawise parses `aws_dynamodb_table`, `aws_sqs_queue`, and `aws_lambda_function` resource blocks from `.tf` files. CDK and CloudFormation equivalents are also supported.
