import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

vi.mock('../probe.js', () => ({
  probePort: vi.fn(),
  scanDotEnv: vi.fn(() => ({})),
}));

vi.mock('../utils.js', () => ({
  readAWSProfiles: vi.fn(() => ['default']),
  detectAWSRegion: vi.fn(() => 'us-east-1'),
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

vi.mock('../interactive-setup.js', () => ({ runInit: vi.fn() }));

describe('runDiscover', () => {
  let tmpDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-discover-'));
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true });
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('writes infrawise.yaml with aws section', async () => {
    const { probePort } = await import('../probe.js');
    vi.mocked(probePort).mockResolvedValue(false);

    const { runDiscover } = await import('../commands/discover.js');
    await runDiscover();

    const yamlPath = path.join(tmpDir, 'infrawise.yaml');
    expect(fs.existsSync(yamlPath)).toBe(true);
    const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed.aws).toBeDefined();
    const aws = parsed.aws as Record<string, unknown>;
    expect(aws.region).toBe('us-east-1');
  });

  it('skips .infrawise/secrets.yaml when no DBs detected', async () => {
    const { probePort } = await import('../probe.js');
    vi.mocked(probePort).mockResolvedValue(false);

    const { runDiscover } = await import('../commands/discover.js');
    await runDiscover();

    const secretsPath = path.join(tmpDir, '.infrawise', 'secrets.yaml');
    expect(fs.existsSync(secretsPath)).toBe(false);
  });

  it('writes .infrawise/secrets.yaml when a DB is detected', async () => {
    const { probePort } = await import('../probe.js');
    vi.mocked(probePort).mockImplementation(async (_host, port) => port === 5432);

    const { runDiscover } = await import('../commands/discover.js');
    await runDiscover();

    const secretsPath = path.join(tmpDir, '.infrawise', 'secrets.yaml');
    expect(fs.existsSync(secretsPath)).toBe(true);
    const parsed = yaml.load(fs.readFileSync(secretsPath, 'utf-8')) as Record<string, unknown>;
    expect((parsed.postgres as Record<string, unknown>).connectionString).toBe('');
  });

  it('copies DATABASE_URL from .env into secrets.yaml', async () => {
    const { probePort, scanDotEnv } = await import('../probe.js');
    vi.mocked(probePort).mockImplementation(async (_host, port) => port === 5432);
    vi.mocked(scanDotEnv).mockReturnValue({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/mydb',
    });

    const { runDiscover } = await import('../commands/discover.js');
    await runDiscover();

    const secretsPath = path.join(tmpDir, '.infrawise', 'secrets.yaml');
    const parsed = yaml.load(fs.readFileSync(secretsPath, 'utf-8')) as Record<string, unknown>;
    expect((parsed.postgres as Record<string, unknown>).connectionString).toBe(
      'postgresql://user:pass@localhost:5432/mydb',
    );
  });

  it('adds .infrawise/ to .gitignore', async () => {
    const { probePort } = await import('../probe.js');
    vi.mocked(probePort).mockResolvedValue(false);

    const { runDiscover } = await import('../commands/discover.js');
    await runDiscover();

    const gitignorePath = path.join(tmpDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    expect(fs.readFileSync(gitignorePath, 'utf-8')).toContain('.infrawise/');
  });

  it('calls runInit when interactive flag is set', async () => {
    const { runInit } = await import('../interactive-setup.js');
    const { runDiscover } = await import('../commands/discover.js');
    await runDiscover({ interactive: true });
    expect(runInit).toHaveBeenCalledOnce();
  });
});
