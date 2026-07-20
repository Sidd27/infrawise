import type { Analyzer, Finding, SystemGraph, GraphNode } from '../types.js';

// ─── Cost signals ────────────────────────────────────────────────────────────
// No billing API involved — every signal here is derived from resource specs
// already extracted (config-level heuristics, not real utilization data).

const HIGH_MEMORY_MB = 3008;
const NON_PROD_NAME = /dev|staging|test|sandbox/i;
const MANY_CACHE_NODES = 3;

export class LambdaHighMemoryAnalyzer implements Analyzer {
  name = 'LambdaHighMemoryAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'lambda') continue;
      if ((node.memoryMB ?? 0) < HIGH_MEMORY_MB) continue;
      if (node.recentThrottles !== 0) continue;
      findings.push({
        severity: 'low',
        issue: `Lambda "${node.name}" has high memory (${node.memoryMB} MB) with zero recent throttles`,
        description: `"${node.name}" is allocated ${node.memoryMB} MB with no recent throttling, which is one signal (not proof) that it may be over-provisioned. AWS Lambda pricing is duration × memory.`,
        recommendation: `Run Lambda Power Tuning on "${node.name}" to find the cost-optimal memory size for its actual workload.`,
        metadata: { functionName: node.name, memoryMB: node.memoryMB },
      });
    }
    return findings;
  }
}

export class RDSMultiAZNonProdAnalyzer implements Analyzer {
  name = 'RDSMultiAZNonProdAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'database_instance') continue;
      if (!node.multiAZ) continue;
      if (!NON_PROD_NAME.test(node.name)) continue;
      findings.push({
        severity: 'low',
        issue: `RDS instance "${node.name}" has Multi-AZ enabled on what looks like a non-production instance`,
        description: `"${node.name}" has Multi-AZ enabled, which roughly doubles RDS cost by running a standby replica. The name suggests a non-production instance, where Multi-AZ is often unnecessary.`,
        recommendation: `If "${node.name}" is not production, disable Multi-AZ to cut its cost roughly in half.`,
        metadata: { dbInstanceIdentifier: node.name, engine: node.engine },
      });
    }
    return findings;
  }
}

type LambdaNode = Extract<GraphNode, { type: 'lambda' }>;
type TableNode = Extract<GraphNode, { type: 'table' }>;
type CacheNode = Extract<GraphNode, { type: 'cache_cluster' }>;

/** Advisory only — no Finding, since there's no runtime-signal evidence either way. */
export function lambdaCostSignal(node: LambdaNode): string | undefined {
  if ((node.memoryMB ?? 0) < HIGH_MEMORY_MB) return undefined;
  if (node.recentThrottles !== undefined) return undefined; // covered by LambdaHighMemoryAnalyzer's Finding when signals are on
  return `${node.memoryMB} MB memory allocated; verify this matches actual workload needs — Lambda Power Tuning can find the cost-optimal size.`;
}

export function dynamoCostSignal(node: TableNode): string | undefined {
  if (node.databaseType !== 'dynamodb') return undefined;
  if (node.billingMode !== 'PROVISIONED') return undefined;
  return 'Provisioned capacity; on-demand may cost less under spiky traffic, provisioned is usually cheaper under steady traffic.';
}

export function cacheCostSignal(node: CacheNode): string | undefined {
  if ((node.numNodes ?? 0) <= MANY_CACHE_NODES) return undefined;
  return `${node.numNodes} nodes; verify traffic justifies ${node.numNodes}× the per-node cost.`;
}
