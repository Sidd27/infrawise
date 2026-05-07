import type { Analyzer, SystemGraph, Finding, GraphNode } from '@infrawise/shared';
import type { IaCSchema } from '@infrawise/adapters-terraform';

/**
 * Detects drift between IaC-defined infrastructure and actually-deployed AWS resources.
 */
export class IaCDriftAnalyzer implements Analyzer {
  name = 'IaCDriftAnalyzer';

  private iacSchema: IaCSchema | null = null;

  setIaCSchema(schema: IaCSchema): void {
    this.iacSchema = schema;
  }

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];

    if (!this.iacSchema) {
      return findings;
    }

    // Get all DynamoDB table names from the graph (deployed in AWS)
    const deployedDynamoTables = new Set<string>(
      graph.nodes
        .filter(
          (n): n is Extract<GraphNode, { type: 'table' }> =>
            n.type === 'table' && n.databaseType === 'dynamodb',
        )
        .map((n) => n.name),
    );

    // Get all DynamoDB table names from IaC (defined in code)
    const iacDynamoTables = new Map<string, string>();
    for (const t of this.iacSchema.dynamoTables) {
      iacDynamoTables.set(t.name, t.filePath);
    }

    // Drift: defined in IaC but not found in deployed graph
    for (const [tableName, filePath] of iacDynamoTables) {
      if (!deployedDynamoTables.has(tableName)) {
        findings.push({
          severity: 'medium',
          issue: `IaC drift: DynamoDB table "${tableName}" is defined in IaC but not found in AWS`,
          description: `Table "${tableName}" is defined in ${filePath} but was not found among deployed AWS DynamoDB tables. It may not have been deployed yet, or may have been deleted from AWS without updating the IaC.`,
          recommendation:
            'Run `terraform apply` or deploy your CloudFormation stack to create the missing table, or remove the definition from your IaC if the table is intentionally absent.',
          metadata: {
            tableName,
            filePath,
            driftType: 'defined_not_deployed',
          },
        });
      }
    }

    // Drift: deployed in AWS but not in IaC
    for (const tableName of deployedDynamoTables) {
      if (!iacDynamoTables.has(tableName)) {
        findings.push({
          severity: 'medium',
          issue: `IaC drift: DynamoDB table "${tableName}" is deployed in AWS but not defined in IaC`,
          description: `Table "${tableName}" exists in AWS DynamoDB but has no corresponding definition in Terraform or CloudFormation. This resource may have been created manually and is not tracked by IaC.`,
          recommendation:
            'Import the table into your IaC using `terraform import` or add a CloudFormation resource definition. Untracked resources can lead to configuration drift and accidental deletion.',
          metadata: {
            tableName,
            driftType: 'deployed_not_defined',
          },
        });
      }
    }

    return findings;
  }
}
