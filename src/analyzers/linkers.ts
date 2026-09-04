import type { SystemGraph, UnresolvedLink } from '../types.js';
import type { IaCLambda } from '../adapters/iac/terraform.js';

export type LinkConfidence = 'inferred' | 'proven';

export interface LambdaCodeLink {
  lambdaId: string;
  functionId: string;
  confidence: LinkConfidence;
}

export interface UnresolvedLambdaLink extends UnresolvedLink {
  lambdaId: string;
}

// A refusal is recorded, never encoded as absence: a Lambda with five matches
// and a Lambda with none must not produce the same output.
export interface LinkResult {
  links: LambdaCodeLink[];
  unresolved: UnresolvedLambdaLink[];
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

function resolve(
  lambdaId: string,
  matches: { id: string }[],
  confidence: LinkConfidence,
  out: LinkResult,
): void {
  const [only] = matches;
  if (matches.length === 1 && only) {
    out.links.push({ lambdaId, functionId: only.id, confidence });
  } else if (matches.length === 0) {
    out.unresolved.push({ lambdaId, reason: 'no_match', candidates: [] });
  } else {
    out.unresolved.push({
      lambdaId,
      reason: 'multiple_functions',
      candidates: matches.map((m) => m.id),
    });
  }
}

export class HeuristicLinker {
  link(graph: SystemGraph): LinkResult {
    const fns = functionNodes(graph);
    const out: LinkResult = { links: [], unresolved: [] };

    // normalizeName deletes the tokens that tell `checkout-handler-prod` from
    // `checkout-dev`, so the collision has to be caught here, where the class
    // is built: nothing downstream can recover the deleted tokens.
    const byKey = new Map<string, { id: string; name: string }[]>();
    for (const lam of lambdaNodes(graph)) {
      const key = normalizeName(lam.name);
      if (!key) {
        out.unresolved.push({ lambdaId: lam.id, reason: 'no_match', candidates: [] });
        continue;
      }
      byKey.set(key, [...(byKey.get(key) ?? []), lam]);
    }

    for (const [key, lams] of byKey) {
      if (lams.length > 1) {
        for (const lam of lams) {
          out.unresolved.push({
            lambdaId: lam.id,
            reason: 'multiple_lambdas',
            candidates: lams.filter((l) => l !== lam).map((l) => l.name),
          });
        }
        continue;
      }
      const [lam] = lams;
      if (!lam) continue;
      const matches = fns.filter((f) => {
        const byName = normalizeName(f.name);
        const byFile = normalizeName(f.file);
        return (byName !== '' && byName === key) || (byFile !== '' && byFile === key);
      });
      resolve(lam.id, matches, 'inferred', out);
    }
    return out;
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

  link(graph: SystemGraph): LinkResult {
    const lambdaIds = new Set(lambdaNodes(graph).map((n) => n.id));
    const fns = functionNodes(graph);
    const out: LinkResult = { links: [], unresolved: [] };
    for (const il of this.iacLambdas) {
      if (!il.handler) continue;
      const lambdaId = `lambda:aws:${il.name}`;
      if (!lambdaIds.has(lambdaId)) continue;
      const { fileBase, exportName } = parseHandler(il.handler);
      if (!exportName || !fileBase) continue;
      const matches = fns.filter(
        (f) => f.name === exportName && fileBaseNoExt(f.file) === fileBase,
      );
      resolve(lambdaId, matches, 'proven', out);
    }
    return out;
  }
}

export function compositeLink(iacLambdas: IaCLambda[], graph: SystemGraph): LinkResult {
  const iac = new IaCHandlerLinker(iacLambdas).link(graph);
  const heuristic = new HeuristicLinker().link(graph);
  const covered = new Set(iac.links.map((l) => l.lambdaId));
  const links = [...iac.links, ...heuristic.links.filter((l) => !covered.has(l.lambdaId))];
  const linked = new Set(links.map((l) => l.lambdaId));
  // The IaC linker's refusal names the declared handler's failure, which is
  // more specific than the name heuristic's, so it wins when both refused.
  const byLambda = new Map<string, UnresolvedLambdaLink>();
  for (const u of [...heuristic.unresolved, ...iac.unresolved]) byLambda.set(u.lambdaId, u);
  const unresolved = [...byLambda.values()].filter((u) => !linked.has(u.lambdaId));
  return { links, unresolved };
}
