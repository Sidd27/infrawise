import type { Analyzer, SystemGraph, Finding, GraphNode } from '../types.js';
import type { IaCSchema } from '../adapters/terraform.js';

export class IaCDriftAnalyzer implements Analyzer {
  name = 'IaCDriftAnalyzer';

  private iacSchema: IaCSchema | null = null;

  setIaCSchema(schema: IaCSchema): void {
    this.iacSchema = schema;
  }

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    if (!this.iacSchema) return findings;

    const iac = this.iacSchema;

    // ── DynamoDB drift ───────────────────────────────────────────────────────

    const deployedDynamo = new Set(
      graph.nodes
        .filter((n): n is Extract<GraphNode, { type: 'table' }> => n.type === 'table' && n.databaseType === 'dynamodb')
        .map((n) => n.name),
    );
    const iacDynamo = new Map(iac.dynamoTables.map((t) => [t.name, t.filePath]));

    for (const [name, fp] of iacDynamo) {
      if (!deployedDynamo.has(name)) {
        findings.push({
          severity: 'medium',
          issue: `IaC drift: DynamoDB table "${name}" defined in IaC but not deployed`,
          description: `"${name}" is in ${fp} but not found in AWS. It may be undeployed or deleted manually.`,
          recommendation: 'Run `terraform apply` / deploy your stack, or remove the definition from IaC.',
          metadata: { resourceType: 'dynamodb_table', name, filePath: fp, driftType: 'defined_not_deployed' },
        });
      }
    }
    for (const name of deployedDynamo) {
      if (!iacDynamo.has(name)) {
        findings.push({
          severity: 'medium',
          issue: `IaC drift: DynamoDB table "${name}" deployed but not in IaC`,
          description: `"${name}" exists in AWS DynamoDB but has no IaC definition. It may have been created manually.`,
          recommendation: 'Import the table with `terraform import` or add a CloudFormation resource, then track all future changes through IaC.',
          metadata: { resourceType: 'dynamodb_table', name, driftType: 'deployed_not_defined' },
        });
      }
    }

    // ── Queue drift ───────────────────────────────────────────────────────────

    const deployedQueues = new Set(
      graph.nodes.filter((n) => n.type === 'queue').map((n) => n.name),
    );
    const iacQueues = new Map(iac.queues.map((q) => [q.name, q.filePath]));

    for (const [name, fp] of iacQueues) {
      if (!deployedQueues.has(name)) {
        findings.push({
          severity: 'medium',
          issue: `IaC drift: SQS queue "${name}" defined in IaC but not deployed`,
          description: `SQS queue "${name}" is defined in ${fp} but not found in the live account.`,
          recommendation: 'Deploy the queue via `terraform apply` or your CFN/CDK stack.',
          metadata: { resourceType: 'sqs_queue', name, filePath: fp, driftType: 'defined_not_deployed' },
        });
      }
    }
    for (const name of deployedQueues) {
      if (!iacQueues.has(name)) {
        findings.push({
          severity: 'low',
          issue: `IaC drift: SQS queue "${name}" deployed but not in IaC`,
          description: `SQS queue "${name}" exists in AWS but is not tracked in IaC. Manual resources can't be audited or reproduced reliably.`,
          recommendation: 'Import or define the queue in IaC to bring it under version control.',
          metadata: { resourceType: 'sqs_queue', name, driftType: 'deployed_not_defined' },
        });
      }
    }

    // ── Lambda drift ──────────────────────────────────────────────────────────

    const deployedLambdas = new Set(
      graph.nodes.filter((n) => n.type === 'lambda').map((n) => n.name),
    );
    const iacLambdas = new Map(iac.lambdas.map((l) => [l.name, l.filePath]));

    for (const [name, fp] of iacLambdas) {
      if (!deployedLambdas.has(name)) {
        findings.push({
          severity: 'medium',
          issue: `IaC drift: Lambda "${name}" defined in IaC but not deployed`,
          description: `Lambda function "${name}" is defined in ${fp} but not found in the live account.`,
          recommendation: 'Deploy the function via `terraform apply` or your CFN/CDK stack.',
          metadata: { resourceType: 'lambda_function', name, filePath: fp, driftType: 'defined_not_deployed' },
        });
      }
    }
    for (const name of deployedLambdas) {
      if (!iacLambdas.has(name)) {
        findings.push({
          severity: 'low',
          issue: `IaC drift: Lambda "${name}" deployed but not in IaC`,
          description: `Lambda "${name}" exists in AWS but is not tracked in IaC.`,
          recommendation: 'Import the function into IaC or add it as a resource.',
          metadata: { resourceType: 'lambda_function', name, driftType: 'deployed_not_defined' },
        });
      }
    }

    return findings;
  }
}
