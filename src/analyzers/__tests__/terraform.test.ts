import { describe, it, expect } from 'vitest';
import { IaCDriftAnalyzer } from '../terraform';
import type { SystemGraph } from '../../types';
import type { IaCSchema } from '../../adapters/iac/terraform';

function makeEmptyIaC(): IaCSchema {
  return {
    dynamoTables: [],
    rdsInstances: [],
    mongoClusters: [],
    queues: [],
    topics: [],
    lambdas: [],
    buckets: [],
    parameters: [],
    secrets: [],
    apiGateways: [],
  };
}

describe('IaCDriftAnalyzer', () => {
  it('returns empty findings when no IaC schema is set', async () => {
    const analyzer = new IaCDriftAnalyzer();
    const graph: SystemGraph = { nodes: [], edges: [] };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('returns empty findings when everything is in sync', async () => {
    const analyzer = new IaCDriftAnalyzer();
    const iac = makeEmptyIaC();
    iac.dynamoTables = [{ name: 'Orders', filePath: 'main.tf', gsiNames: [], source: 'terraform' }];
    iac.queues = [{ name: 'orders-queue', filePath: 'main.tf', hasDLQ: false, encrypted: false, source: 'terraform' }];
    iac.lambdas = [{ name: 'processOrders', filePath: 'main.tf', source: 'terraform' }];
    analyzer.setIaCSchema(iac);

    const graph: SystemGraph = {
      nodes: [
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
        { id: 'queue:aws:orders-queue', type: 'queue', name: 'orders-queue', provider: 'aws', hasDLQ: false, encrypted: true },
        { id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders' },
      ],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  describe('DynamoDB drift', () => {
    it('flags DynamoDB table defined in IaC but not deployed', async () => {
      const analyzer = new IaCDriftAnalyzer();
      const iac = makeEmptyIaC();
      iac.dynamoTables = [{ name: 'Orders', filePath: 'main.tf', gsiNames: [], source: 'terraform' }];
      analyzer.setIaCSchema(iac);

      const graph: SystemGraph = { nodes: [], edges: [] };
      const findings = await analyzer.analyze(graph);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('medium');
      expect(findings[0].issue).toContain('Orders');
      expect(findings[0].metadata?.driftType).toBe('defined_not_deployed');
    });

    it('flags DynamoDB table deployed but not in IaC', async () => {
      const analyzer = new IaCDriftAnalyzer();
      analyzer.setIaCSchema(makeEmptyIaC());

      const graph: SystemGraph = {
        nodes: [{ id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' }],
        edges: [],
      };
      const findings = await analyzer.analyze(graph);
      expect(findings).toHaveLength(1);
      expect(findings[0].issue).toContain('Orders');
      expect(findings[0].metadata?.driftType).toBe('deployed_not_defined');
    });
  });

  describe('SQS queue drift', () => {
    it('flags queue defined in IaC but not deployed', async () => {
      const analyzer = new IaCDriftAnalyzer();
      const iac = makeEmptyIaC();
      iac.queues = [{ name: 'orders-queue', filePath: 'queues.tf', hasDLQ: false, encrypted: false, source: 'terraform' }];
      analyzer.setIaCSchema(iac);

      const graph: SystemGraph = { nodes: [], edges: [] };
      const findings = await analyzer.analyze(graph);
      expect(findings).toHaveLength(1);
      expect(findings[0].issue).toContain('orders-queue');
      expect(findings[0].metadata?.driftType).toBe('defined_not_deployed');
    });

    it('flags queue deployed but not in IaC', async () => {
      const analyzer = new IaCDriftAnalyzer();
      analyzer.setIaCSchema(makeEmptyIaC());

      const graph: SystemGraph = {
        nodes: [{ id: 'queue:aws:orders-queue', type: 'queue', name: 'orders-queue', provider: 'aws', hasDLQ: false, encrypted: true }],
        edges: [],
      };
      const findings = await analyzer.analyze(graph);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('low');
      expect(findings[0].metadata?.driftType).toBe('deployed_not_defined');
    });
  });

  describe('Lambda drift', () => {
    it('flags Lambda defined in IaC but not deployed', async () => {
      const analyzer = new IaCDriftAnalyzer();
      const iac = makeEmptyIaC();
      iac.lambdas = [{ name: 'processOrders', filePath: 'lambdas.tf', source: 'terraform' }];
      analyzer.setIaCSchema(iac);

      const graph: SystemGraph = { nodes: [], edges: [] };
      const findings = await analyzer.analyze(graph);
      expect(findings).toHaveLength(1);
      expect(findings[0].issue).toContain('processOrders');
      expect(findings[0].metadata?.driftType).toBe('defined_not_deployed');
    });

    it('flags Lambda deployed but not in IaC', async () => {
      const analyzer = new IaCDriftAnalyzer();
      analyzer.setIaCSchema(makeEmptyIaC());

      const graph: SystemGraph = {
        nodes: [{ id: 'lambda:aws:processOrders', type: 'lambda', name: 'processOrders' }],
        edges: [],
      };
      const findings = await analyzer.analyze(graph);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('low');
      expect(findings[0].metadata?.driftType).toBe('deployed_not_defined');
    });
  });

  it('reports multiple drift findings across resource types', async () => {
    const analyzer = new IaCDriftAnalyzer();
    const iac = makeEmptyIaC();
    iac.dynamoTables = [{ name: 'MissingTable', filePath: 'main.tf', gsiNames: [], source: 'terraform' }];
    iac.queues = [{ name: 'MissingQueue', filePath: 'main.tf', hasDLQ: false, encrypted: false, source: 'terraform' }];
    analyzer.setIaCSchema(iac);

    const graph: SystemGraph = { nodes: [], edges: [] };
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(2);
  });
});
