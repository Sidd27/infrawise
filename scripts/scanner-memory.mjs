import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));

if (process.argv[2] !== '--worker') {
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--worker'], {
    stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '' }, timeout: 180000,
  });
  process.exit(result.status ?? 1);
}
const { scanRepository } = await import('../dist/context/index.js');
const { RepositoryScanner } = await import('../dist/context/incremental.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-memory-'));
const count = 1500;
const normalize = (ops) => ops.map((op) => JSON.stringify(op)).sort();
try {
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules/large-types'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'));
  const fields = Array.from({ length: 300 }, (_, i) => `field${i}: { value: string; nested: number[] };`).join('\n');
  fs.writeFileSync(path.join(root, 'node_modules/large-types/index.d.ts'), `export interface Huge { ${fields.repeat(100)} }`);
  fs.writeFileSync(path.join(root, 'dist/bundle.js'), 'x'.repeat(3 * 1024 * 1024));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['**/*'], compilerOptions: { allowJs: true } }));
  fs.writeFileSync(path.join(root, 'src/shared.ts'), 'export const value = 1;');
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(root, `src/handler-${i}.ts`),
    `import type { Huge } from 'large-types'; import { value } from './shared';
export interface Payload${i} { ${fields} }
const sql = 'SELECT id FROM orders WHERE customer_id = $1';
export function handler${i}() { return pool.query(sql, [value]); }`);
  const start = performance.now();
  const full = await scanRepository(root);
  assert.equal(full.length, count);
  const scanner = new RepositoryScanner(root);
  assert.deepEqual(normalize(await scanner.scan()), normalize(full));
  fs.writeFileSync(path.join(root, 'src/handler-0.ts'), "export function handler0() { return pool.query('SELECT id FROM users WHERE id = $1', [1]); }");
  assert.deepEqual(normalize(await scanner.scan(['src/handler-0.ts'])), normalize(await scanRepository(root)));
  fs.writeFileSync(path.join(root, 'src/shared.ts'), 'export const value = 2;');
  assert.deepEqual(normalize(await scanner.scan(['src/shared.ts'])), normalize(await scanRepository(root)));
  fs.writeFileSync(path.join(root, 'infrawise.yaml'), 'project: memory-regression\n');
  const cliResult = spawnSync(process.execPath, ['--max-old-space-size=256', cli, 'analyze', '--config', path.join(root, 'infrawise.yaml'), '--output', path.join(root, 'report.md')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' }, timeout: 120000,
  });
  assert.equal(cliResult.status, 0, cliResult.stderr + cliResult.stdout);
  const cache = path.join(root, '.infrawise/cache');
  assert.ok(fs.readdirSync(cache).some((file) => fs.readFileSync(path.join(cache, file), 'utf8').includes('handler1499')));
  console.log(JSON.stringify({ passed: true, cliAnalyzePassed: true, files: count + 1, sourceMiB: +(count * fields.length / 1024 / 1024).toFixed(1), heapLimitMiB: 256,
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), elapsedSeconds: +((performance.now() - start) / 1000).toFixed(2) }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
