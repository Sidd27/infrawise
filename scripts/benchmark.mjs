import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { RepositoryScanner } from '../dist/context/incremental.js';
import { scanRepository } from '../dist/context/index.js';
import { buildGraph } from '../dist/graph/index.js';
import { MissingIndexAnalyzer } from '../dist/analyzers/postgres.js';

const count = Number(process.argv[2] ?? 1000);
if (!Number.isInteger(count) || count < 10 || count > 20000)
  throw Error('File count must be an integer from 10 to 20000');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-benchmark-'));
const normalized = (operations) => operations.map((operation) => JSON.stringify(operation)).sort();
const measure = async (fn) => {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
};
try {
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
      include: ['packages/**/*.ts'],
    }),
  );
  fs.mkdirSync(path.join(root, 'packages/shared'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages/shared/index.ts'), 'export const tenant = "demo";');
  for (let i = 0; i < count; i++) {
    const directory = path.join(root, `packages/service-${Math.floor(i / 100)}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, `handler-${i}.ts`),
      `import { tenant } from '../shared/index.js'; export async function handler${i}() { return pool.query('SELECT id FROM orders WHERE customer_id = $1', [tenant]); }`,
    );
  }
  const scanner = new RepositoryScanner(root);
  const initial = await measure(() => scanner.scan());
  const file = path.join(root, 'packages/service-0/handler-0.ts');
  fs.writeFileSync(
    file,
    "export async function handler0() { return pool.query('SELECT id FROM orders WHERE id = $1', [1]); }",
  );
  const incremental = await measure(() => scanner.scan([file]));
  const full = await measure(() => scanRepository(root));
  assert.deepEqual(normalized(incremental.value), normalized(full.value));
  const shared = path.join(root, 'packages/shared/index.ts');
  fs.writeFileSync(shared, 'export const tenant = "changed";');
  const fanout = await measure(() => scanner.scan([shared]));
  assert.deepEqual(normalized(fanout.value), normalized(full.value));
  const resourceCount = Math.max(1, Math.floor(count / 10));
  const tables = Array.from({ length: resourceCount }, (_, index) => ({
    schema: 'public',
    table: `orders_${index}`,
    columns: ['id', 'customer_id'],
    indexes: [`orders_${index}_pkey`],
    primaryKeys: ['id'],
    indexDetails: [
      {
        name: `orders_${index}_pkey`,
        columns: ['id'],
        method: 'btree',
        partial: false,
        valid: true,
      },
    ],
  }));
  const graphOperations = incremental.value.map((operation, index) => ({
    ...operation,
    target: `orders_${index % resourceCount}`,
  }));
  const graph = await measure(() => buildGraph(graphOperations, [], tables));
  const analysis = await measure(() => MissingIndexAnalyzer(graph.value));
  assert.equal(analysis.value.length, resourceCount);
  const client = new Client({ name: 'benchmark', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../dist/cli/index.js', import.meta.url)), 'serve', '--stdio'],
    cwd: root,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', () => {});
  let discovery;
  try {
    discovery = await measure(async () => {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.length, 22);
    });
  } finally {
    await client.close();
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        files: count + 1,
        resources: resourceCount,
        fixture: 'packages with shared imports and SQL predicates',
        initialScanMs: initial.ms,
        incrementalScanMs: incremental.ms,
        sharedImportRefreshMs: fanout.ms,
        fullScanMs: full.ms,
        graphBuildMs: graph.ms,
        indexAnalysisMs: analysis.ms,
        mcpDiscoveryMs: discovery.ms,
        identicalOperations: true,
        operations: incremental.value.length,
        nodes: graph.value.nodes.length,
        edges: graph.value.edges.length,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
