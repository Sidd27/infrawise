import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setCacheDir, appendSourceHistory, consecutiveSourceFailures } from '../index.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-src-history-'));
  setCacheDir(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('appendSourceHistory / consecutiveSourceFailures', () => {
  it('counts consecutive failed runs and breaks on a healthy one', () => {
    appendSourceHistory([{ service: 'sqs', status: 'failed', error: 'AccessDenied' }]);
    appendSourceHistory([{ service: 'sqs', status: 'failed', error: 'AccessDenied' }]);
    appendSourceHistory([{ service: 'sqs', status: 'ok' }]);
    expect(consecutiveSourceFailures('sqs')).toBe(0);
  });

  it('returns the streak only for sources that keep failing', () => {
    appendSourceHistory([{ service: 'sqs', status: 'failed', error: 'AccessDenied' }]);
    appendSourceHistory([
      { service: 'sqs', status: 'failed', error: 'AccessDenied' },
      { service: 'lambda', status: 'failed', error: 'Timeout' },
    ]);
    expect(consecutiveSourceFailures('sqs')).toBe(2);
    expect(consecutiveSourceFailures('lambda')).toBe(1);
  });

  it('returns 0 when no history exists', () => {
    expect(consecutiveSourceFailures('sqs')).toBe(0);
  });

  it('ignores disabled and partial sources', () => {
    appendSourceHistory([{ service: 'sqs', status: 'disabled' }]);
    appendSourceHistory([{ service: 'sqs', status: 'partial', error: 'gap' }]);
    expect(consecutiveSourceFailures('sqs')).toBe(0);
  });

  it('tolerates a corrupted history file', () => {
    fs.mkdirSync(path.join(dir, '.infrawise', 'cache'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.infrawise', 'cache', 'source-history.json'), 'not json');
    expect(consecutiveSourceFailures('sqs')).toBe(0);
  });
});
