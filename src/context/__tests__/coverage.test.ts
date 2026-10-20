import { expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanRepository } from '../index.js';
import { PartialExtractionError } from '../../core/index.js';

vi.mock('../python.js', () => ({
  scanPythonRepository: vi.fn().mockRejectedValue(new Error('Python unavailable')),
}));
it('retains TS operations and reports partial coverage when Python cannot be scanned', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-coverage-'));
  try {
    fs.writeFileSync(
      path.join(root, 'handler.ts'),
      'async function read() { return client.send(new ScanCommand({ TableName: "Orders" })); }',
    );
    fs.writeFileSync(path.join(root, 'handler.py'), 'def read(): pass');
    const error = await scanRepository(root).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PartialExtractionError);
    expect((error as PartialExtractionError<unknown[]>).data).toEqual([
      expect.objectContaining({ target: 'Orders' }),
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
