import type { SystemGraph, UnresolvedLink } from '../types.js';
import type { IaCLambda } from '../adapters/iac/terraform.js';

export type LinkConfidence = 'inferred' | 'proven';
export type HandlerSource = 'deployed' | 'declared';
export type HandlerDrift = 'in_sync' | 'modified' | 'not_checked';

export interface LambdaCodeLink {
  lambdaId: string;
  functionId: string;
  confidence: LinkConfidence;
  // Set only on proven links: which source resolved the handler, and whether a
  // declared and a deployed handler were both read and disagree.
  handlerSource?: HandlerSource;
  handlerDrift?: HandlerDrift;
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
type FunctionNode = ReturnType<typeof functionNodes>[number];

function resolve(
  lambdaId: string,
  matches: { id: string }[],
  confidence: LinkConfidence,
  out: LinkResult,
  provenance: Pick<LambdaCodeLink, 'handlerSource' | 'handlerDrift'> = {},
): void {
  const [only] = matches;
  if (matches.length === 1 && only) {
    out.links.push({ lambdaId, functionId: only.id, confidence, ...provenance });
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
  // Scanner paths are posix for TS on every platform, but the Python scanner
  // emits os.path.join output, which is backslash-separated on Windows.
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.(ts|js|mjs|cjs|py)$/, '');
}

function handlerMatches(handler: string, fns: FunctionNode[]): FunctionNode[] {
  const { fileBase, exportName } = parseHandler(handler);
  if (!exportName || !fileBase) return [];
  return fns.filter((f) => f.name === exportName && fileBaseNoExt(f.file) === fileBase);
}

function driftOf(deployed?: string, declared?: string): HandlerDrift {
  if (!deployed || !declared) return 'not_checked';
  return deployed === declared ? 'in_sync' : 'modified';
}

// The deployed handler is what the running function uses, so it resolves first;
// the declaration is the fallback, not a competitor. A Lambda whose deployment
// names code outside the scan keeps that refusal instead of falling through to
// a name guess: the name is not evidence against the handler string.
export class HandlerLinker {
  constructor(private readonly iacLambdas: IaCLambda[]) {}

  link(graph: SystemGraph): LinkResult {
    const fns = functionNodes(graph);
    const out: LinkResult = { links: [], unresolved: [] };
    const declaredByName = new Map<string, string | undefined>();
    for (const il of this.iacLambdas) {
      if (!declaredByName.has(il.name)) declaredByName.set(il.name, il.handler);
    }
    for (const lam of lambdaNodes(graph)) {
      const deployed = lam.handler;
      const declared = declaredByName.get(lam.name);
      const drift = driftOf(deployed, declared);
      const viaDeployed = deployed ? handlerMatches(deployed, fns) : [];
      const viaDeclared = declared ? handlerMatches(declared, fns) : [];
      if (viaDeployed.length > 0) {
        resolve(lam.id, viaDeployed, 'proven', out, {
          handlerSource: 'deployed',
          handlerDrift: drift,
        });
      } else if (viaDeclared.length > 0) {
        resolve(lam.id, viaDeclared, 'proven', out, {
          handlerSource: 'declared',
          handlerDrift: drift,
        });
      } else if (deployed) {
        out.unresolved.push({ lambdaId: lam.id, reason: 'deployed_no_match', candidates: [] });
      } else if (declared) {
        out.unresolved.push({ lambdaId: lam.id, reason: 'no_match', candidates: [] });
      }
    }
    return out;
  }
}

export function compositeLink(iacLambdas: IaCLambda[], graph: SystemGraph): LinkResult {
  const handler = new HandlerLinker(iacLambdas).link(graph);
  const heuristic = new HeuristicLinker().link(graph);
  const covered = new Set(handler.links.map((l) => l.lambdaId));
  // A handler that was read and still left the Lambda unresolved is stronger
  // evidence than a name similarity, so those Lambdas are not eligible for the
  // heuristic either. Without this the refusal is dropped for exactly the
  // Lambdas whose name collides with a scanned file, and the edge silently
  // reads `inferred`.
  const byId = new Map(lambdaNodes(graph).map((n) => [n.id, n] as const));
  const contradicted = new Set(
    handler.unresolved.filter((u) => Boolean(byId.get(u.lambdaId)?.handler)).map((u) => u.lambdaId),
  );
  const links = [
    ...handler.links,
    ...heuristic.links.filter((l) => !covered.has(l.lambdaId) && !contradicted.has(l.lambdaId)),
  ];
  const linked = new Set(links.map((l) => l.lambdaId));
  // The handler refusal names the file the deployment runs, which is more
  // specific than the name heuristic's, so it wins when both refused.
  const byLambda = new Map<string, UnresolvedLambdaLink>();
  for (const u of [...heuristic.unresolved, ...handler.unresolved]) byLambda.set(u.lambdaId, u);
  const unresolved = [...byLambda.values()].filter((u) => !linked.has(u.lambdaId));
  return { links, unresolved };
}
