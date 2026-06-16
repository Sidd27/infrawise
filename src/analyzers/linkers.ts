import type { SystemGraph } from '../types.js';
import type { IaCLambda } from '../adapters/iac/terraform.js';

export type LinkConfidence = 'inferred' | 'proven';

export interface LambdaCodeLink {
  lambdaId: string;
  functionId: string;
  confidence: LinkConfidence;
}

const STAGE_TOKENS = new Set([
  'prod',
  'production',
  'dev',
  'development',
  'staging',
  'stage',
  'test',
  'qa',
]);
const NOISE_TOKENS = new Set(['handler', 'fn', 'func', 'function', 'lambda']);

export function normalizeName(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.split('/').pop() ?? s;
  s = s.replace(/\.(ts|js|mjs|cjs)$/, '');
  let segs = s.split(/[-_.\s]+/).filter(Boolean);
  if (segs.length > 1 && STAGE_TOKENS.has(segs[segs.length - 1] ?? '')) segs.pop();
  segs = segs.filter((seg) => !NOISE_TOKENS.has(seg));
  return segs.join('');
}

function lambdaNodes(graph: SystemGraph) {
  return graph.nodes.filter((n): n is Extract<typeof n, { type: 'lambda' }> => n.type === 'lambda');
}
function functionNodes(graph: SystemGraph) {
  return graph.nodes.filter(
    (n): n is Extract<typeof n, { type: 'function' }> => n.type === 'function',
  );
}

export class HeuristicLinker {
  link(graph: SystemGraph): LambdaCodeLink[] {
    const fns = functionNodes(graph);
    const links: LambdaCodeLink[] = [];
    for (const lam of lambdaNodes(graph)) {
      const target = normalizeName(lam.name);
      if (!target) continue;
      const matches = fns.filter((f) => {
        const byName = normalizeName(f.name);
        const byFile = normalizeName(f.file);
        return (byName !== '' && byName === target) || (byFile !== '' && byFile === target);
      });
      if (matches.length !== 1) continue;
      const [only] = matches;
      if (!only) continue;
      links.push({ lambdaId: lam.id, functionId: only.id, confidence: 'inferred' });
    }
    return links;
  }
}

function parseHandler(handler: string): { fileBase: string; exportName: string } {
  const lastDot = handler.lastIndexOf('.');
  if (lastDot < 0) return { fileBase: '', exportName: '' };
  const exportName = handler.slice(lastDot + 1);
  const filePart = handler.slice(0, lastDot);
  const fileBase = filePart.split('/').pop() ?? filePart;
  return { fileBase, exportName };
}

function fileBaseNoExt(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.(ts|js|mjs|cjs)$/, '');
}

export class IaCHandlerLinker {
  constructor(private readonly iacLambdas: IaCLambda[]) {}

  link(graph: SystemGraph): LambdaCodeLink[] {
    const lambdaIds = new Set(lambdaNodes(graph).map((n) => n.id));
    const fns = functionNodes(graph);
    const links: LambdaCodeLink[] = [];
    for (const il of this.iacLambdas) {
      if (!il.handler) continue;
      const lambdaId = `lambda:aws:${il.name}`;
      if (!lambdaIds.has(lambdaId)) continue;
      const { fileBase, exportName } = parseHandler(il.handler);
      if (!exportName || !fileBase) continue;
      const matches = fns.filter(
        (f) => f.name === exportName && fileBaseNoExt(f.file) === fileBase,
      );
      if (matches.length !== 1) continue;
      const [only] = matches;
      if (!only) continue;
      links.push({ lambdaId, functionId: only.id, confidence: 'proven' });
    }
    return links;
  }
}

export function compositeLink(iacLambdas: IaCLambda[], graph: SystemGraph): LambdaCodeLink[] {
  const proven = new IaCHandlerLinker(iacLambdas).link(graph);
  const covered = new Set(proven.map((l) => l.lambdaId));
  return [...proven, ...new HeuristicLinker().link(graph).filter((l) => !covered.has(l.lambdaId))];
}
