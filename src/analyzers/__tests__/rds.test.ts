import { describe, it, expect } from 'vitest';
import {
  RDSPubliclyAccessibleAnalyzer,
  RDSNoBackupAnalyzer,
  RDSUnencryptedAnalyzer,
  RDSNoDeletionProtectionAnalyzer,
  RDSNoMultiAZAnalyzer,
} from '../rds';
import type { SystemGraph } from '../../types';

function makeGraph(instances: Array<{
  name: string;
  publiclyAccessible?: boolean;
  storageEncrypted?: boolean;
  backupRetentionDays?: number;
  deletionProtection?: boolean;
  multiAZ?: boolean;
}>): SystemGraph {
  return {
    nodes: instances.map((inst) => ({
      id: `database_instance:aws:${inst.name}`,
      type: 'database_instance' as const,
      name: inst.name,
      provider: 'aws',
      engine: 'postgres',
      engineVersion: '15.4',
      instanceClass: 'db.t3.medium',
      publiclyAccessible: inst.publiclyAccessible ?? false,
      storageEncrypted: inst.storageEncrypted ?? true,
      backupRetentionDays: inst.backupRetentionDays ?? 7,
      deletionProtection: inst.deletionProtection ?? true,
      multiAZ: inst.multiAZ ?? true,
    })),
    edges: [],
  };
}

describe('RDSPubliclyAccessibleAnalyzer', () => {
  const analyzer = new RDSPubliclyAccessibleAnalyzer();

  it('flags publicly accessible instances', async () => {
    const graph = makeGraph([{ name: 'prod-db', publiclyAccessible: true }]);
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].issue).toContain('prod-db');
  });

  it('does not flag private instances', async () => {
    const graph = makeGraph([{ name: 'internal-db', publiclyAccessible: false }]);
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('only acts on database_instance nodes', async () => {
    const graph: SystemGraph = {
      nodes: [{ id: 'q', type: 'queue', name: 'my-queue', provider: 'aws', hasDLQ: false, encrypted: false }],
      edges: [],
    };
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('RDSNoBackupAnalyzer', () => {
  const analyzer = new RDSNoBackupAnalyzer();

  it('flags instances with 0-day backup retention', async () => {
    const graph = makeGraph([{ name: 'no-backup-db', backupRetentionDays: 0 }]);
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].metadata?.backupRetentionDays).toBe(0);
  });

  it('does not flag instances with backup enabled', async () => {
    const graph = makeGraph([{ name: 'backed-up-db', backupRetentionDays: 7 }]);
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('RDSUnencryptedAnalyzer', () => {
  const analyzer = new RDSUnencryptedAnalyzer();

  it('flags unencrypted instances', async () => {
    const graph = makeGraph([{ name: 'plain-db', storageEncrypted: false }]);
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
  });

  it('does not flag encrypted instances', async () => {
    const graph = makeGraph([{ name: 'secure-db', storageEncrypted: true }]);
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('RDSNoDeletionProtectionAnalyzer', () => {
  const analyzer = new RDSNoDeletionProtectionAnalyzer();

  it('flags instances without deletion protection', async () => {
    const graph = makeGraph([{ name: 'unprotected-db', deletionProtection: false }]);
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
  });

  it('does not flag instances with deletion protection enabled', async () => {
    const graph = makeGraph([{ name: 'protected-db', deletionProtection: true }]);
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });
});

describe('RDSNoMultiAZAnalyzer', () => {
  const analyzer = new RDSNoMultiAZAnalyzer();

  it('flags single-AZ instances', async () => {
    const graph = makeGraph([{ name: 'single-az-db', multiAZ: false }]);
    const findings = await analyzer.analyze(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('low');
  });

  it('does not flag multi-AZ instances', async () => {
    const graph = makeGraph([{ name: 'multi-az-db', multiAZ: true }]);
    expect(await analyzer.analyze(graph)).toHaveLength(0);
  });

  it('flags multiple single-AZ instances', async () => {
    const graph = makeGraph([
      { name: 'db-1', multiAZ: false },
      { name: 'db-2', multiAZ: false },
      { name: 'db-3', multiAZ: true },
    ]);
    expect(await analyzer.analyze(graph)).toHaveLength(2);
  });
});
