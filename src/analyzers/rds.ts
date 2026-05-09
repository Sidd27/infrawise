import type { Analyzer, Finding, SystemGraph } from '../types';

// ─── RDS ─────────────────────────────────────────────────────────────────────

export class RDSPubliclyAccessibleAnalyzer implements Analyzer {
  name = 'RDSPubliclyAccessibleAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'database_instance') continue;
      if (node.publiclyAccessible) {
        findings.push({
          severity: 'high',
          issue: `RDS instance "${node.name}" is publicly accessible`,
          description: `"${node.name}" (${node.engine}) has PubliclyAccessible=true, meaning it is reachable from the internet. This exposes the database to brute-force and credential-stuffing attacks.`,
          recommendation: `Set PubliclyAccessible=false on "${node.name}" and use a bastion host, VPN, or VPC peering for private access. If public access is required, enforce strong passwords, IP allowlisting, and TLS.`,
          metadata: { dbInstanceIdentifier: node.name, engine: node.engine, instanceClass: node.instanceClass },
        });
      }
    }
    return findings;
  }
}

export class RDSNoBackupAnalyzer implements Analyzer {
  name = 'RDSNoBackupAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'database_instance') continue;
      if (node.backupRetentionDays === 0) {
        findings.push({
          severity: 'high',
          issue: `RDS instance "${node.name}" has automated backups disabled`,
          description: `"${node.name}" has a backup retention period of 0, meaning automated backups are off. Any accidental deletion or corruption is unrecoverable without a manual snapshot.`,
          recommendation: `Enable automated backups on "${node.name}" with at least 7 days retention (35 days for production workloads). Enable point-in-time recovery.`,
          metadata: { dbInstanceIdentifier: node.name, engine: node.engine, backupRetentionDays: node.backupRetentionDays },
        });
      }
    }
    return findings;
  }
}

export class RDSUnencryptedAnalyzer implements Analyzer {
  name = 'RDSUnencryptedAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'database_instance') continue;
      if (!node.storageEncrypted) {
        findings.push({
          severity: 'medium',
          issue: `RDS instance "${node.name}" has unencrypted storage`,
          description: `"${node.name}" does not have storage encryption enabled. Data at rest (including automated backups and read replicas) is stored unencrypted.`,
          recommendation: `Enable storage encryption on "${node.name}" using an AWS KMS key. Note: encryption must be enabled at creation time — you'll need to create a new encrypted instance and migrate.`,
          metadata: { dbInstanceIdentifier: node.name, engine: node.engine },
        });
      }
    }
    return findings;
  }
}

export class RDSNoDeletionProtectionAnalyzer implements Analyzer {
  name = 'RDSNoDeletionProtectionAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'database_instance') continue;
      if (!node.deletionProtection) {
        findings.push({
          severity: 'medium',
          issue: `RDS instance "${node.name}" has deletion protection disabled`,
          description: `"${node.name}" can be deleted without any additional safeguard. A mistaken Terraform destroy, IaC misconfiguration, or human error could permanently drop the database.`,
          recommendation: `Enable DeletionProtection on "${node.name}". This must be explicitly disabled before the instance can be deleted, preventing accidental data loss.`,
          metadata: { dbInstanceIdentifier: node.name, engine: node.engine },
        });
      }
    }
    return findings;
  }
}

export class RDSNoMultiAZAnalyzer implements Analyzer {
  name = 'RDSNoMultiAZAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'database_instance') continue;
      if (!node.multiAZ) {
        findings.push({
          severity: 'low',
          issue: `RDS instance "${node.name}" is single-AZ`,
          description: `"${node.name}" does not have Multi-AZ enabled. An AZ outage will cause downtime until the instance is recovered in the same AZ.`,
          recommendation: `Enable Multi-AZ on "${node.name}" to get automatic failover to a standby in a separate Availability Zone. Typical failover is 60–120 seconds.`,
          metadata: { dbInstanceIdentifier: node.name, engine: node.engine },
        });
      }
    }
    return findings;
  }
}
