import type { SqlAccess } from '../types.js';

function normalizeSql(sql: string): string {
  return sql
    .replace(
      /\$([a-z_]\w*)\$[\s\S]*?\$\1\$|\$\$[\s\S]*?\$\$|'(?:''|\\[\s\S]|[^'\\])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|--[^\n]*|\/\*[\s\S]*?\*\//gi,
      (token) => {
        if (token.startsWith('"') || token.startsWith('`')) return token;
        return token.startsWith('--') || token.startsWith('/*') ? ' ' : '?';
      },
    )
    .trim();
}

export function sqlTableName(sql: string): string {
  const text = normalizeSql(sql);
  if (text.includes("'")) return 'unknown';
  const match =
    /\b(?:FROM|INTO|UPDATE)\s+((?:"[^"]+"|`[^`]+`|[a-z_][\w$]*)(?:\.(?:"[^"]+"|`[^`]+`|[a-z_][\w$]*))?)/i.exec(
      text,
    );
  return match?.[1]?.replace(/["`]/g, '') ?? 'unknown';
}

export function analyzeSql(sql: string): SqlAccess {
  const normalized = normalizeSql(sql);
  const where = /\bWHERE\b([\s\S]*?)(?:\bORDER\s+BY\b|\bGROUP\s+BY\b|\bLIMIT\b|;?$)/i
    .exec(normalized)?.[1]
    ?.trim();
  const result: SqlAccess = {
    equalityColumns: [],
    rangeColumns: [],
    complete: !/\b(?:JOIN|UNION|WITH|OR|HAVING)\b|["`']|;\s*\S/i.test(normalized),
    hasWhere: /\bWHERE\b/i.test(normalized),
    selectAll: /^SELECT\s+(?:\w+\.)?\*/i.test(normalized),
  };
  if ((normalized.match(/\bSELECT\b/gi)?.length ?? 0) > 1) result.complete = false;
  if (!where) return result;
  for (const part of where.split(/\bAND\b/i)) {
    const match =
      /^\s*(?:\w+\.)?([a-z_][\w$]*)\s*(=|>=|<=|>|<)\s*(?:\?|\$\d+|%s|:\w+|-?\d+(?:\.\d+)?|NULL|true|false)\s*$/i.exec(
        part,
      );
    if (!match) {
      result.complete = false;
      continue;
    }
    const columns = match[2] === '=' ? result.equalityColumns : result.rangeColumns;
    columns.push(match[1]);
  }
  return result;
}
