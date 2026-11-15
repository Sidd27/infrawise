import type { Finding, SystemGraph, GraphNode } from '../types.js';
import type { IaCLambda } from '../adapters/iac/terraform.js';
import { type LambdaCodeLink, compositeLink } from './linkers.js';

const TRANSPORT_EDGES = new Set(['publishes_to', 'triggers']);

// The linkers already resolve deployed Lambda names to source functions for
// finding generation. Writing them into the graph is what lets the MCP layer
// answer "what triggers the handler I am editing" when the deployed name is
// stack-prefixed and shares no string with the function name.
export function addLambdaCodeLinks(graph: SystemGraph, iacLambdas: IaCLambda[] = []): void {
  const { links, unresolved } = compositeLink(iacLambdas, graph);
  for (const link of links) {
    graph.edges.push({
      from: link.lambdaId,
      to: link.functionId,
      type: 'implemented_by',
      confidence: link.confidence,
    });
  }
  for (const { lambdaId, reason, candidates } of unresolved) {
    const node = graph.nodes.find((n) => n.id === lambdaId);
    if (node?.type === 'lambda') node.unresolvedLink = { reason, candidates };
  }
}

export async function PipelineAnalyzer(
  graph: SystemGraph,
  iacLambdas: IaCLambda[] = [],
): Promise<Finding[]> {
  const { links } = compositeLink(iacLambdas, graph);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  return [
    ...detectMissingDlqHop(graph),
    ...detectScanInPipeline(graph, links, nodeById),
    ...detectRepeatedTableAccess(graph, links, nodeById),
  ];
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function buildComponents(
  graph: SystemGraph,
  links: LambdaCodeLink[],
): {
  uf: UnionFind;
  inferredRoots: Set<string>;
} {
  const uf = new UnionFind();
  for (const e of graph.edges) {
    if (TRANSPORT_EDGES.has(e.type)) uf.union(e.from, e.to);
  }
  for (const l of links) uf.union(l.lambdaId, l.functionId);
  const inferredRoots = new Set<string>();
  for (const l of links) {
    if (l.confidence === 'inferred') inferredRoots.add(uf.find(l.lambdaId));
  }
  return { uf, inferredRoots };
}

function detectMissingDlqHop(graph: SystemGraph): Finding[] {
  const hasProducer = new Set<string>();
  const hasConsumer = new Set<string>();
  for (const e of graph.edges) {
    if (e.type === 'publishes_to') hasProducer.add(e.to);
    if (e.type === 'triggers') hasConsumer.add(e.from);
  }
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'queue' || node.hasDLQ) continue;
    if (!hasProducer.has(node.id) || !hasConsumer.has(node.id)) continue;
    findings.push({
      severity: 'medium',
      issue: `Queue "${node.name}" sits mid-pipeline without a Dead Letter Queue`,
      description: `Queue "${node.name}" has both a producer and a downstream consumer but no DLQ. A failure in the consumer drops the message silently, breaking the pipeline with no recovery path.`,
      recommendation: `Add a Dead Letter Queue to "${node.name}" with maxReceiveCount 3-5, and alert on DLQ depth so mid-pipeline failures are visible.`,
      metadata: { queueName: node.name, pipelineHop: true },
    });
  }
  return findings;
}

function detectScanInPipeline(
  graph: SystemGraph,
  links: LambdaCodeLink[],
  nodeById: Map<string, GraphNode>,
): Finding[] {
  const triggeredLambdas = new Set<string>();
  for (const e of graph.edges) {
    if (e.type === 'triggers') triggeredLambdas.add(e.to);
  }
  // Several Lambdas declaring one handler is the ordinary shape of a shared
  // entrypoint, so one function can be reached by more than one deployment.
  // Collapsing them to a single link made the named Lambda depend on link
  // order, and let a later name-heuristic link mask a proven one.
  const triggeredFunctionLinks = new Map<string, LambdaCodeLink[]>();
  for (const l of links) {
    if (!triggeredLambdas.has(l.lambdaId)) continue;
    const existing = triggeredFunctionLinks.get(l.functionId);
    if (existing) existing.push(l);
    else triggeredFunctionLinks.set(l.functionId, [l]);
  }
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (e.type !== 'scan') continue;
    const fnLinks = triggeredFunctionLinks.get(e.from);
    if (!fnLinks) continue;
    const fn = nodeById.get(e.from);
    const table = nodeById.get(e.to);
    if (!fn || fn.type !== 'function' || !table || table.type !== 'table') continue;
    const dedupe = `${e.from}\0${e.to}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    // The same Lambda can be declared twice (a module and its root, or two
    // workspaces the parser cannot tell apart). Reporting that name twice would
    // inflate the very count this finding exists to get right.
    const lambdas = [...new Map(fnLinks.map((l) => [l.lambdaId, l])).values()]
      .map((l) => {
        const node = nodeById.get(l.lambdaId);
        return {
          lambda: node && node.type === 'lambda' ? node.name : l.lambdaId,
          confidence: l.confidence,
        };
      })
      .sort(
        (a, b) =>
          (a.lambda < b.lambda ? -1 : a.lambda > b.lambda ? 1 : 0) ||
          (a.confidence < b.confidence ? -1 : a.confidence > b.confidence ? 1 : 0),
      );
    const named = lambdas.map((l) => `"${l.lambda}" (${l.confidence})`).join(', ');
    const many = lambdas.length > 1;
    const inferred = lambdas.some((l) => l.confidence === 'inferred');
    findings.push({
      severity: lambdas.some((l) => l.confidence === 'proven') ? 'high' : 'verify',
      issue: many
        ? `Full scan runs inside ${lambdas.length} event-triggered Lambdas: ${named}`
        : `Full scan runs inside event-triggered Lambda ${named}`,
      description:
        `Function "${fn.name}" (${fn.file}) performs a full scan on table "${table.name}" and runs as the handler for ${many ? 'event-triggered Lambdas:' : 'event-triggered Lambda'} ${named}. A scan inside an event-driven consumer executes on every invocation, multiplying read cost with traffic.` +
        (inferred
          ? many
            ? ` Lambdas marked inferred are matched by name, not proven from IaC, so verify them before acting.`
            : ` The link is inferred by name match, not proven from IaC, so verify it before acting.`
          : many
            ? ` Every link is proven from IaC handler configuration.`
            : ` The Lambda-to-code link is proven from IaC handler configuration.`),
      recommendation: `Replace the scan with a Query using a partition key, or add a GSI for the access pattern. Scans in per-event handlers are the highest-leverage place to fix.`,
      metadata: { function: fn.name, table: table.name, lambdas },
    });
  }
  return findings;
}

function detectRepeatedTableAccess(
  graph: SystemGraph,
  links: LambdaCodeLink[],
  nodeById: Map<string, GraphNode>,
): Finding[] {
  const { uf, inferredRoots } = buildComponents(graph, links);
  const access = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.type !== 'query' && e.type !== 'scan') continue;
    const fromNode = nodeById.get(e.from);
    const toNode = nodeById.get(e.to);
    if (!fromNode || fromNode.type !== 'function') continue;
    if (!toNode || toNode.type !== 'table') continue;
    const key = `${uf.find(e.from)}\0${e.to}`;
    const set = access.get(key) ?? new Set<string>();
    set.add(e.from);
    access.set(key, set);
  }
  const findings: Finding[] = [];
  for (const [key, fns] of access) {
    if (fns.size < 2) continue;
    const [root, tableId] = key.split('\0') as [string, string];
    const table = nodeById.get(tableId);
    if (!table || table.type !== 'table') continue;
    const fnNames = [...fns]
      .map((id) => nodeById.get(id))
      .filter((n): n is Extract<GraphNode, { type: 'function' }> => !!n && n.type === 'function')
      .map((n) => `${n.name} (${n.file})`)
      .sort();
    const inferred = inferredRoots.has(root);
    findings.push({
      severity: inferred ? 'verify' : 'medium',
      issue: `Table "${table.name}" is accessed at multiple stages of one pipeline`,
      description:
        `Table "${table.name}" is read by ${fns.size} functions linked in the same service pipeline: ${fnNames.join(', ')}. Re-reading the same table across pipeline stages often signals redundant work that could be passed forward in the message payload.` +
        (inferred
          ? ` One or more Lambda-to-code links on this pipeline are inferred by name match (not proven from IaC), so verify the chain before acting.`
          : ''),
      recommendation: `Confirm each access is necessary. Consider carrying the needed fields in the event payload, caching the first read, or consolidating the reads. If the duplication is intentional, no action needed.`,
      metadata: { tableName: table.name, functions: fnNames, inferred },
    });
  }
  return findings;
}
