import { afterEach, beforeEach, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanRepository } from '../index.js';
import { getTypeScriptInputs, MAX_SOURCE_BYTES } from '../inputs.js';
import { RepositoryScanner } from '../incremental.js';
import { PartialExtractionError } from '../../core/index.js';

let root: string;
const write = (file: string, text: string) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};
const handler = (table: string) =>
  `export function read() { return client.send(new ScanCommand({ TableName: '${table}' })); }`;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-inputs-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

it('filters dependency declarations and generated output before loading even with explicit tsconfig files', async () => {
  write('src/orders.ts', handler('Orders'));
  write('node_modules/types/index.d.ts', handler('Dependency'));
  write('.next/server.js', handler('Generated'));
  write('dist/app.js', handler('Built'));
  write('schema.d.ts', handler('Declaration'));
  write(
    'tsconfig.json',
    JSON.stringify({
      files: [
        'src/orders.ts',
        'node_modules/types/index.d.ts',
        '.next/server.js',
        'dist/app.js',
        'schema.d.ts',
      ],
      compilerOptions: { allowJs: true },
    }),
  );
  expect(getTypeScriptInputs(root).files).toEqual([path.join(root, 'src/orders.ts')]);
  expect((await scanRepository(root)).map((op) => op.target)).toEqual(['Orders']);
});

it('honors extended config includes and exclusions without a compiler project', async () => {
  write('base.json', JSON.stringify({ include: ['src/**/*.ts'], exclude: ['src/excluded.ts'] }));
  write('tsconfig.json', JSON.stringify({ extends: './base.json' }));
  write('src/orders.ts', handler('Orders'));
  write('src/excluded.ts', handler('Excluded'));
  write('other.ts', handler('Other'));
  expect((await scanRepository(root)).map((op) => op.target)).toEqual(['Orders']);
});

it('reports oversized files as partial coverage and retains readable operations', async () => {
  write('orders.ts', handler('Orders'));
  write('large.ts', ' '.repeat(MAX_SOURCE_BYTES + 1));
  const error = await scanRepository(root).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(PartialExtractionError);
  expect((error as Error).message).toContain('large.ts: exceeds');
  expect((error as PartialExtractionError<unknown[]>).data).toEqual([
    expect.objectContaining({ target: 'Orders' }),
  ]);
});

it('resolves local SQL constants and shadowing without loading external types', async () => {
  write(
    'orders.ts',
    `import type { Client } from 'large-library';
const sql = 'SELECT id FROM orders WHERE id = $1';
export function orders() { return pool.query(sql, [1]); }
export function users() { const sql = 'SELECT id FROM users WHERE id = $1'; return pool.query(sql, [1]); }`,
  );
  const operations = await scanRepository(root);
  expect(operations.map((op) => [op.functionName, op.target])).toEqual([
    ['orders', 'orders'],
    ['users', 'users'],
  ]);
});

it('does not recurse indefinitely on circular SQL constants', async () => {
  write('orders.ts', 'const a = b; const b = a; export function read() { return pool.query(a); }');
  expect(await scanRepository(root)).toEqual([expect.objectContaining({ target: 'unknown' })]);
});

it('tracks path aliases, reexports and newly created dependencies in watch sessions', async () => {
  write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@shared/*': ['shared/*'] } },
      include: ['**/*.ts'],
    }),
  );
  write('shared/middle.ts', "export { value } from './new';");
  write('orders.ts', "import { value } from '@shared/middle'; " + handler('Orders'));
  const scanner = new RepositoryScanner(root);
  await scanner.scan();
  write('shared/new.ts', 'export const value = 1;');
  expect(await scanner.scan(['shared/new.ts'])).toEqual(await scanRepository(root));
  fs.unlinkSync(path.join(root, 'shared/middle.ts'));
  expect(await scanner.scan(['shared/middle.ts'])).toEqual(await scanRepository(root));
});

it('keeps script-local constants independent across full and incremental scans', async () => {
  write(
    'orders.ts',
    "const sql = 'SELECT id FROM orders'; function readOrders() { return pool.query(sql); }",
  );
  write(
    'users.ts',
    "const sql = 'SELECT id FROM users'; function readUsers() { return pool.query(sql); }",
  );
  const scanner = new RepositoryScanner(root);
  const initial = await scanner.scan();
  expect(initial.map((op) => op.target).sort()).toEqual(['orders', 'users']);
  write(
    'orders.ts',
    "const sql = 'SELECT id FROM changed_orders'; function readOrders() { return pool.query(sql); }",
  );
  const normalize = (operations: Awaited<ReturnType<typeof scanRepository>>) =>
    operations.map((op) => JSON.stringify(op)).sort();
  expect(normalize(await scanner.scan(['orders.ts']))).toEqual(
    normalize(await scanRepository(root)),
  );
});
