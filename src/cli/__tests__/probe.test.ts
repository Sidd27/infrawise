import { describe, it, expect, vi, afterEach } from 'vitest';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('net', () => ({
  Socket: vi.fn(),
}));

describe('probePort', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns true when port responds', async () => {
    const { probePort } = await import('../probe.js');
    const mockSocket = {
      setTimeout: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'connect') setTimeout(cb, 0);
        return mockSocket;
      }),
      connect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(net.Socket).mockImplementation(
      class {
        setTimeout = mockSocket.setTimeout;
        on = mockSocket.on;
        connect = mockSocket.connect;
        destroy = mockSocket.destroy;
      } as unknown as typeof net.Socket,
    );
    const result = await probePort('localhost', 5432, 300);
    expect(result).toBe(true);
  });

  it('returns false when connection times out', async () => {
    const { probePort } = await import('../probe.js');
    const mockSocket = {
      setTimeout: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'timeout') setTimeout(cb, 0);
        return mockSocket;
      }),
      connect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(net.Socket).mockImplementation(
      class {
        setTimeout = mockSocket.setTimeout;
        on = mockSocket.on;
        connect = mockSocket.connect;
        destroy = mockSocket.destroy;
      } as unknown as typeof net.Socket,
    );
    const result = await probePort('localhost', 9999, 300);
    expect(result).toBe(false);
  });

  it('returns false on connection error', async () => {
    const { probePort } = await import('../probe.js');
    const mockSocket = {
      setTimeout: vi.fn(),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'error') setTimeout(cb, 0);
        return mockSocket;
      }),
      connect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(net.Socket).mockImplementation(
      class {
        setTimeout = mockSocket.setTimeout;
        on = mockSocket.on;
        connect = mockSocket.connect;
        destroy = mockSocket.destroy;
      } as unknown as typeof net.Socket,
    );
    const result = await probePort('localhost', 9999, 300);
    expect(result).toBe(false);
  });
});

describe('scanDotEnv', () => {
  it('returns empty object when no .env file exists', async () => {
    const { scanDotEnv } = await import('../probe.js');
    const result = scanDotEnv('/nonexistent/path');
    expect(result).toEqual({});
  });

  it('parses DATABASE_URL from .env', async () => {
    const { scanDotEnv } = await import('../probe.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'DATABASE_URL=postgresql://user:pass@localhost:5432/mydb\n',
      );
      const result = scanDotEnv(tmpDir);
      expect(result['DATABASE_URL']).toBe('postgresql://user:pass@localhost:5432/mydb');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('strips surrounding quotes from values', async () => {
    const { scanDotEnv } = await import('../probe.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '.env'), 'MONGO_URI="mongodb://localhost:27017"\n');
      const result = scanDotEnv(tmpDir);
      expect(result['MONGO_URI']).toBe('mongodb://localhost:27017');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('ignores comment lines', async () => {
    const { scanDotEnv } = await import('../probe.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '.env'), '# This is a comment\nFOO=bar\n');
      const result = scanDotEnv(tmpDir);
      expect(result['FOO']).toBe('bar');
      expect(Object.keys(result)).not.toContain('# This is a comment');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
