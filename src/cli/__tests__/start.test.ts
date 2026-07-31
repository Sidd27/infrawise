import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../utils.js', () => ({
  log: {
    success: vi.fn(),
    warn: vi.fn(),
    dim: vi.fn(),
    fail: vi.fn(),
    info: vi.fn(),
    skip: vi.fn(),
  },
  printHeader: vi.fn(),
}));

import { writeVscodeMcp, writeMcpConfig } from '../commands/start.js';

describe('writeVscodeMcp', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-start-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const readConfig = () =>
    JSON.parse(fs.readFileSync(path.join(tmpDir, '.vscode', 'mcp.json'), 'utf-8')) as {
      servers: Record<string, { type: string; command: string; args: string[] }>;
    };

  it('creates .vscode/mcp.json with the infrawise server', () => {
    writeVscodeMcp('/abs/infrawise.yaml');
    const config = readConfig();
    expect(config.servers['infrawise']).toEqual({
      type: 'stdio',
      command: 'infrawise',
      args: ['serve', '--stdio', '--config', '/abs/infrawise.yaml'],
    });
  });

  it('merges into an existing mcp.json without dropping other servers', () => {
    fs.mkdirSync(path.join(tmpDir, '.vscode'));
    fs.writeFileSync(
      path.join(tmpDir, '.vscode', 'mcp.json'),
      JSON.stringify({
        servers: { other: { type: 'stdio', command: 'other-server', args: [] } },
        inputs: [{ id: 'token', type: 'promptString' }],
      }),
      'utf-8',
    );
    writeVscodeMcp('/abs/infrawise.yaml');
    const config = readConfig();
    expect(config.servers['other']).toEqual({ type: 'stdio', command: 'other-server', args: [] });
    expect(config.servers['infrawise'].command).toBe('infrawise');
    expect((config as Record<string, unknown>)['inputs']).toEqual([
      { id: 'token', type: 'promptString' },
    ]);
  });

  it('merges .mcp.json without dropping other servers', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }),
      'utf-8',
    );
    writeMcpConfig('/abs/infrawise.yaml', '.mcp.json', 'MCP');
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, { command: string }>;
    };
    expect(config.mcpServers['other']).toEqual({ command: 'other-server' });
    expect(config.mcpServers['infrawise'].command).toBe('infrawise');
  });

  it('replaces an invalid mcp.json instead of crashing', () => {
    fs.mkdirSync(path.join(tmpDir, '.vscode'));
    fs.writeFileSync(path.join(tmpDir, '.vscode', 'mcp.json'), 'not json', 'utf-8');
    writeVscodeMcp('/abs/infrawise.yaml');
    expect(readConfig().servers['infrawise'].command).toBe('infrawise');
  });
});
