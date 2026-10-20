import type { Finding, SystemGraph } from '../types.js';

export function relationalIndexFindings(
  graph: SystemGraph,
  databaseType: 'postgres' | 'mysql',
): Finding[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const findings: Finding[] = [];
  for (const table of graph.nodes) {
    if (table.type !== 'table' || table.databaseType !== databaseType || table.placeholder)
      continue;
    const indexes = graph.edges
      .filter((edge) => edge.from === table.id && edge.type === 'uses_index')
      .map((edge) => nodes.get(edge.to))
      .filter((node) => node?.type === 'index');
    const accesses = graph.edges.filter(
      (edge) => edge.to === table.id && (edge.type === 'query' || edge.type === 'scan'),
    );
    const missing = new Set<string>();
    const affectedFunctions = new Set<string>();
    for (const edge of accesses) {
      if (edge.type !== 'query' && edge.type !== 'scan') continue;
      const access = edge.sqlAccess;
      if (!access?.complete || !access.hasWhere) continue;
      const eq = access.equalityColumns.map((column) => column.toLowerCase());
      const range = access.rangeColumns.map((column) => column.toLowerCase());
      const usable = indexes.some((index) => {
        if (!index || index.valid === false || index.partial || !index.columns?.[0]) return false;
        const first = index.columns[0].toLowerCase();
        return (
          (index.method === 'btree' && (eq.includes(first) || range.includes(first))) ||
          (index.method === 'hash' && index.columns.length === 1 && eq.includes(first))
        );
      });
      if (usable) continue;
      const uncertain = indexes.some(
        (index) =>
          index &&
          index.valid !== false &&
          (!index.columns ||
            index.partial ||
            index.columns.some((column) => !column) ||
            !['btree', 'hash'].includes(index.method ?? '')),
      );
      if (uncertain) continue;
      for (const column of [...eq, ...range]) missing.add(column);
      affectedFunctions.add(edge.from);
    }
    const legacyMissing =
      indexes.length === 0 &&
      accesses.some((edge) => (edge.type === 'query' || edge.type === 'scan') && !edge.sqlAccess);
    if (missing.size === 0 && !legacyMissing) continue;
    if (legacyMissing) for (const edge of accesses) affectedFunctions.add(edge.from);
    const columns = [...missing];
    findings.push({
      severity: 'medium',
      issue: columns.length
        ? `No matching leading-column index observed on ${databaseType === 'postgres' ? 'PostgreSQL' : 'MySQL'} table "${table.name}" for ${columns.join(', ')}`
        : `${databaseType === 'postgres' ? 'PostgreSQL' : 'MySQL'} table "${table.name}" has no indexes but is queried`,
      description:
        'The extracted predicates do not match a supported index leading column. This is a static access-pattern warning, not an observed query plan; optimizer choices, skip scans, and data distribution can change execution.',
      recommendation:
        'Review the filter columns and composite-index order. Use EXPLAIN before adding an index; an unrelated primary-key index does not cover these predicates.',
      metadata: {
        tableName: table.name,
        columns,
        queryCount: accesses.length,
        functionIds: [...affectedFunctions],
        callerFunctions: [...affectedFunctions]
          .map((id) => {
            const node = nodes.get(id);
            return node?.type === 'function' ? node.name : id;
          })
          .join(', '),
      },
    });
  }
  return findings;
}
