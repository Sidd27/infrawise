import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as context from '../index.js';
import { RepositoryScanner } from '../incremental.js';

const hasPython = ['python3', 'python', 'py'].some(
  (cmd) => spawnSync(cmd, ['--version']).status === 0,
);

describe('incremental repository scan', () => {
  let dir: string;
  const source = (table: string) =>
    `async function read() { await client.send(new ScanCommand({ TableName: '${table}' })); }`;
  const write = (file: string, contents: string) =>
    fs.writeFileSync(path.join(dir, file), contents);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-incremental-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('scans only edited files and preserves unchanged operations', async () => {
    write('orders.ts', source('Orders'));
    write('users.ts', source('Users'));
    const scanner = new RepositoryScanner(dir);
    await scanner.scan();
    const scan = vi.spyOn(context, 'scanTypeScriptFiles');
    write('orders.ts', source('UpdatedOrders'));
    const operations = await scanner.scan(['orders.ts']);
    expect(scan.mock.calls[0]?.[0].map((file) => path.basename(file.getFilePath()))).toEqual([
      'orders.ts',
    ]);
    expect(operations.map((op) => op.target).sort()).toEqual(['UpdatedOrders', 'Users']);
    expect(operations).toEqual(expect.arrayContaining(await context.scanRepository(dir)));
  });

  it('removes deleted and newly empty files, and discovers added files', async () => {
    write('orders.ts', source('Orders'));
    write('users.ts', source('Users'));
    const scanner = new RepositoryScanner(dir);
    await scanner.scan();
    fs.unlinkSync(path.join(dir, 'orders.ts'));
    write('users.ts', 'export const unused = true;');
    write('added.js', source('Added'));
    const operations = await scanner.scan(['orders.ts', 'users.ts', 'added.js']);
    expect(operations.map((op) => op.target)).toEqual(['Added']);
  });

  it('rescans transitive importers when a shared file changes or is deleted', async () => {
    write('shared.ts', 'export const value = 1;');
    write('middle.ts', 'export { value } from "./shared";');
    write('handler.ts', 'import { value } from "./middle";\n' + source('Orders'));
    write('unrelated.ts', source('Users'));
    const scanner = new RepositoryScanner(dir);
    await scanner.scan();
    const scan = vi.spyOn(context, 'scanTypeScriptFiles');
    fs.unlinkSync(path.join(dir, 'shared.ts'));
    await scanner.scan(['shared.ts']);
    expect(scan.mock.calls[0]?.[0].map((file) => path.basename(file.getFilePath())).sort()).toEqual(
      ['handler.ts', 'middle.ts'],
    );
  });

  it('rebuilds the project when tsconfig changes its included files', async () => {
    write('orders.ts', source('Orders'));
    write('users.ts', source('Users'));
    write('tsconfig.json', JSON.stringify({ files: ['orders.ts'] }));
    const scanner = new RepositoryScanner(dir);
    expect((await scanner.scan()).map((op) => op.target)).toEqual(['Orders']);
    write('excluded.ts', source('Excluded'));
    expect((await scanner.scan(['excluded.ts'])).map((op) => op.target)).toEqual(['Orders']);
    write('tsconfig.json', JSON.stringify({ files: ['users.ts'] }));
    expect((await scanner.scan(['tsconfig.json'])).map((op) => op.target)).toEqual(['Users']);
  });

  it.skipIf(!hasPython)(
    'refreshes only changed Python files and removes deleted operations',
    async () => {
      write(
        'orders.py',
        'import boto3\nclient = boto3.client("dynamodb")\ndef read():\n client.scan(TableName="Orders")\n',
      );
      write('users.ts', source('Users'));
      const scanner = new RepositoryScanner(dir);
      await scanner.scan();
      write(
        'orders.py',
        'import boto3\nclient = boto3.client("dynamodb")\ndef read():\n client.scan(TableName="Updated")\n',
      );
      expect((await scanner.scan(['orders.py'])).map((op) => op.target).sort()).toEqual([
        'Updated',
        'Users',
      ]);
      fs.unlinkSync(path.join(dir, 'orders.py'));
      expect((await scanner.scan(['orders.py'])).map((op) => op.target)).toEqual(['Users']);
    },
  );
});
