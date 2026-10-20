import ts from 'typescript';

export function behaviorErrors(serverSource, docs) {
  const errors = [];
  const tree = ts.createSourceFile('server.ts', serverSource, ts.ScriptTarget.Latest, true);
  let fields = [];
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(tree) === 'dataHealth' &&
      ts.isObjectLiteralExpression(node.initializer)
    )
      fields = node.initializer.properties
        .map((property) => property.name?.getText(tree))
        .filter(Boolean);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!fields.length) errors.push('Could not discover dataHealth fields in src/server/index.ts');
  const reference = docs['website/src/content/docs/reference/data-freshness.md'] ?? '';
  for (const field of fields)
    if (!reference.includes('`' + field + '`'))
      errors.push(`Data freshness reference omits ${field}`);
  for (const [name, text] of Object.entries(docs)) {
    if (/a `freshness` object|analysis\.severity|live account every time it is asked/.test(text))
      errors.push(`${name}: obsolete public behavior claim`);
  }
  for (const name of [
    'README.md',
    'AGENTS.md',
    'llms.txt',
    'website/src/content/docs/reference/cli.md',
  ]) {
    const text = docs[name] ?? '';
    for (const phrase of ['--allow-incomplete', 'exit 2'])
      if (!text.includes(phrase)) errors.push(`${name}: missing CI behavior ${phrase}`);
  }
  for (const name of [
    'README.md',
    'AGENTS.md',
    'llms.txt',
    'website/src/content/docs/reference/mcp-tools.md',
  ]) {
    if (!(docs[name] ?? '').includes('errorsObserved'))
      errors.push(`${name}: missing metadata-only log behavior`);
  }
  return errors;
}
