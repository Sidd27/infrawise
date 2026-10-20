import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-gaps-e2e-'));
for (const file of ['app', 'infrawise.yaml', 'tsconfig.json'])
  fs.cpSync(path.join(repo, 'demo/local', file), path.join(cwd, file), { recursive: true });
const config = path.join(cwd, 'infrawise.yaml');
fs.writeFileSync(
  config,
  fs
    .readFileSync(config, 'utf8')
    .replace('refreshIntervalMinutes: 15', 'refreshIntervalMinutes: 1'),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repo, 'dist/cli/index.js'), 'serve', '--stdio'],
  cwd,
  env: { ...process.env },
  stderr: 'pipe',
});
let logs = '';
transport.stderr.on('data', (chunk) => (logs += chunk));
const client = new Client({ name: 'gaps-e2e', version: '1' });
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, JSON.stringify(r));
  return JSON.parse(r.content[0].text);
}
async function until(fn, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Error('Timed out');
}
async function cli(args, dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repo, 'dist/cli/index.js'), ...args], {
      cwd: dir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}
try {
  const start = performance.now();
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 22);
  const discoveryMs = performance.now() - start;
  assert.ok(!fs.existsSync(path.join(cwd, '.infrawise/cache/graph.json')));
  const overview = await call('get_infra_overview');
  for (const service of ['postgres', 'mysql', 'mongodb', 'code'])
    assert.equal(
      overview.dataHealth.sources.find((s) => s.service === service)?.status,
      'ok',
      JSON.stringify(overview.dataHealth),
    );
  const schema = await call('get_table_schema', { tables: ['index_access_cases'] });
  assert.equal(schema.tables[0].matches.length, 2);
  for (const match of schema.tables[0].matches)
    assert.deepEqual(match.indexes.find((i) => i.name === 'idx_access_tenant_customer')?.columns, [
      'tenant_id',
      'customer_id',
    ]);
  for (const fn of ['postgresTrailingColumn', 'mysqlTrailingColumn']) {
    const result = await call('analyze_function', { function: fn, file: 'app/index-coverage.ts' });
    assert.ok(
      result.issues.some((issue) => issue.issue.includes('leading-column')),
      JSON.stringify(result),
    );
  }
  for (const fn of ['postgresLeadingColumns', 'mysqlLeadingColumns']) {
    const result = await call('analyze_function', { function: fn, file: 'app/index-coverage.ts' });
    assert.ok(
      !result.issues.some((issue) => issue.issue.includes('leading-column')),
      JSON.stringify(result),
    );
  }
  const graph = await call('get_graph_summary');
  assert.ok(graph.unresolvedReferences.some((ref) => ref.function === 'unresolvedQuery'));
  assert.ok(graph.unresolvedReferences.some((ref) => ref.function === 'python_dynamic_query'));
  assert.ok(graph.dataHealth.codeCoverage.unsupportedSqlOperations > 0);
  const log = await call('get_log_errors');
  assert.ok(log.note.includes('never requested'));
  assert.ok(
    log.logGroups.every(
      (group) =>
        group.errorsObserved === false &&
        group.errorCount === null &&
        group.topErrorPatterns.length === 0,
    ),
  );
  const before = logs.length;
  const file = path.join(cwd, 'app/index-coverage.ts');
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('WHERE customer_id = $1', 'WHERE id = $1'),
  );
  await until(() => logs.slice(before).includes('code graph refreshed from cache'));
  const changed = await call('analyze_function', {
    function: 'postgresTrailingColumn',
    file: 'app/index-coverage.ts',
  });
  assert.ok(
    !changed.issues.some((issue) => issue.issue.includes('leading-column')),
    JSON.stringify(changed),
  );
  assert.equal(changed.dataHealth.analyzedAt, overview.dataHealth.analyzedAt);
  console.log(
    'PASS: ordered PostgreSQL/MySQL indexes, leading-column findings, function scope, unresolved SQL, source-only freshness',
  );
  const negative = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-ci-negative-'));
  try {
    fs.writeFileSync(
      path.join(negative, 'infrawise.yaml'),
      'project: negative\npostgres:\n  enabled: true\n  connectionString: postgres://demo:demo@localhost:19999/demodb\nterraform:\n  enabled: false\n',
    );
    const blocked = await cli(['check'], negative);
    assert.equal(blocked.code, 2, blocked.output);
    const allowed = await cli(['check', '--allow-incomplete'], negative);
    assert.equal(allowed.code, 0, allowed.output);
    console.log('PASS: real CLI incomplete extraction exits 2; explicit override exits 0');
  } finally {
    fs.rmSync(negative, { recursive: true, force: true });
  }
  if (process.argv.includes('--background')) {
    console.log('Waiting for the configured background refresh...');
    await until(async () => {
      const r = await call('get_infra_overview');
      return r.dataHealth.analyzedAt !== overview.dataHealth.analyzedAt;
    }, 70000);
  }
  console.log(
    'PASS',
    JSON.stringify({
      discoveryMs,
      initialSummary: overview.summary,
      backgroundRefresh: process.argv.includes('--background'),
      codeCoverage: graph.dataHealth.codeCoverage,
    }),
  );
} catch (err) {
  console.error(err);
  console.error(logs);
  process.exitCode = 1;
} finally {
  await client.close();
  fs.rmSync(cwd, { recursive: true, force: true });
}
