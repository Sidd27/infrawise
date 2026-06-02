import type { Analyzer, Finding, SystemGraph } from '../types.js';

// ─── SQS ─────────────────────────────────────────────────────────────────────

export class MissingDLQAnalyzer implements Analyzer {
  name = 'MissingDLQAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'queue') continue;
      if (!node.hasDLQ) {
        findings.push({
          severity: 'high',
          issue: `Queue "${node.name}" has no Dead Letter Queue`,
          description: `SQS queue "${node.name}" has no DLQ configured. Failed messages will be discarded after maxReceiveCount retries, causing silent data loss.`,
          recommendation: `Add a Dead Letter Queue to "${node.name}". Set maxReceiveCount to 3–5 retries before routing to DLQ. Alert on DLQ depth.`,
          metadata: { queueName: node.name, provider: node.provider },
        });
      }
    }
    return findings;
  }
}

export class UnencryptedQueueAnalyzer implements Analyzer {
  name = 'UnencryptedQueueAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'queue') continue;
      if (!node.encrypted) {
        findings.push({
          severity: 'low',
          issue: `Queue "${node.name}" is not encrypted`,
          description: `SQS queue "${node.name}" does not have server-side encryption enabled. Messages at rest are unencrypted.`,
          recommendation: `Enable SQS-managed SSE (SqsManagedSseEnabled=true) or bring your own KMS key for "${node.name}".`,
          metadata: { queueName: node.name },
        });
      }
    }
    return findings;
  }
}

export class LargeQueueBacklogAnalyzer implements Analyzer {
  name = 'LargeQueueBacklogAnalyzer';

  private readonly threshold: number;

  constructor(threshold = 1000) {
    this.threshold = threshold;
  }

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'queue') continue;
      const count = node.approximateMessages ?? 0;
      if (count > this.threshold) {
        findings.push({
          severity: 'medium',
          issue: `Queue "${node.name}" has a large backlog (${count.toLocaleString()} messages)`,
          description: `The approximate message count for "${node.name}" is ${count.toLocaleString()}, indicating consumers may be falling behind or stuck.`,
          recommendation: `Check consumer health and scaling for "${node.name}". Consider auto-scaling consumers on queue depth. If messages are stale, investigate consumer errors in CloudWatch.`,
          metadata: { queueName: node.name, messageCount: count },
        });
      }
    }
    return findings;
  }
}

// ─── Secrets Manager ─────────────────────────────────────────────────────────

export class MissingSecretRotationAnalyzer implements Analyzer {
  name = 'MissingSecretRotationAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'secret') continue;
      if (!node.rotationEnabled) {
        findings.push({
          severity: 'medium',
          issue: `Secret "${node.name}" has no automatic rotation`,
          description: `Secrets Manager secret "${node.name}" does not have automatic rotation enabled. Long-lived credentials increase the blast radius of a compromise.`,
          recommendation: `Enable automatic rotation for "${node.name}" using a Lambda rotation function. AWS provides pre-built rotators for RDS, Redshift, and custom secrets.`,
          metadata: { secretName: node.name, provider: node.provider },
        });
      }
    }
    return findings;
  }
}

// ─── CloudWatch Logs ─────────────────────────────────────────────────────────

export class MissingLogRetentionAnalyzer implements Analyzer {
  name = 'MissingLogRetentionAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'log_group') continue;
      if (node.retentionDays === undefined) {
        findings.push({
          severity: 'medium',
          issue: `Log group "${node.name}" has no retention policy`,
          description: `CloudWatch Log group "${node.name}" retains logs indefinitely. This increases storage costs and can expose sensitive data longer than necessary.`,
          recommendation: `Set a retention policy on "${node.name}". 90 days is a common baseline; adjust based on compliance requirements (e.g., 365 days for SOC2/PCI).`,
          metadata: { logGroupName: node.name },
        });
      } else if (node.retentionDays > 365) {
        findings.push({
          severity: 'low',
          issue: `Log group "${node.name}" retains logs for ${node.retentionDays} days`,
          description: `Log group "${node.name}" has a ${node.retentionDays}-day retention period. Unless required by compliance, this may be longer than needed.`,
          recommendation: `Review whether ${node.retentionDays} days of retention is required for "${node.name}". Consider archiving older logs to S3 Glacier for cost savings.`,
          metadata: { logGroupName: node.name, retentionDays: node.retentionDays },
        });
      }
    }
    return findings;
  }
}

// ─── Lambda ───────────────────────────────────────────────────────────────────

export class LambdaDefaultMemoryAnalyzer implements Analyzer {
  name = 'LambdaDefaultMemoryAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'lambda') continue;
      if (node.memoryMB === 128) {
        findings.push({
          severity: 'low',
          issue: `Lambda "${node.name}" uses the default 128 MB memory`,
          description: `"${node.name}" uses the default 128 MB. Undersized memory causes throttled CPU and higher durations. AWS Lambda pricing is duration × memory, so more memory often lowers cost by reducing duration.`,
          recommendation: `Run Lambda Power Tuning on "${node.name}" to find the optimal memory/cost balance. Most workloads perform better at 512 MB–1 GB.`,
          metadata: { functionName: node.name, memoryMB: node.memoryMB },
        });
      }
    }
    return findings;
  }
}

export class LambdaMissingTriggerDLQAnalyzer implements Analyzer {
  name = 'LambdaMissingTriggerDLQAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'lambda') continue;
      for (const trigger of node.triggers ?? []) {
        if (trigger.type !== 'sqs' && trigger.type !== 'kinesis' && trigger.type !== 'dynamodb') continue;
        // Check if there's a DLQ/destination on the trigger edge — we flag if the source queue itself has no DLQ
        // and the trigger is active, since failures will be silently dropped
        const sourceQueue = graph.nodes.find(
          (n) => n.type === 'queue' && n.name === trigger.sourceName
        );
        if (sourceQueue && sourceQueue.type === 'queue' && !sourceQueue.hasDLQ) {
          findings.push({
            severity: 'high',
            issue: `Lambda "${node.name}" is triggered by "${trigger.sourceName}" which has no DLQ`,
            description: `"${node.name}" receives events from "${trigger.sourceName}" (${trigger.type.toUpperCase()}). If the Lambda handler fails, messages will be retried and eventually discarded with no failure record.`,
            recommendation: `Add a DLQ to "${trigger.sourceName}" and set a destination config on the event source mapping so failed batches are captured and inspectable.`,
            metadata: { functionName: node.name, triggerSource: trigger.sourceName, triggerType: trigger.type },
          });
        }
      }
    }
    return findings;
  }
}

export class LambdaHighTimeoutAnalyzer implements Analyzer {
  name = 'LambdaHighTimeoutAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'lambda') continue;
      if ((node.timeoutSec ?? 0) >= 300) {
        findings.push({
          severity: 'low',
          issue: `Lambda "${node.name}" has a very high timeout (${node.timeoutSec}s)`,
          description: `"${node.name}" has a ${node.timeoutSec}-second timeout. High timeouts mask latency issues and increase worst-case cost when functions hang.`,
          recommendation: `Review whether "${node.name}" truly needs ${node.timeoutSec}s. Add internal circuit-breakers or streaming patterns to avoid reaching the timeout. Set alarms on p99 duration.`,
          metadata: { functionName: node.name, timeoutSec: node.timeoutSec },
        });
      }
    }
    return findings;
  }
}

// ─── S3 ──────────────────────────────────────────────────────────────────────

export class S3PublicAccessAnalyzer implements Analyzer {
  name = 'S3PublicAccessAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'bucket') continue;
      if (node.publicAccessBlocked === false) {
        findings.push({
          severity: 'verify',
          issue: `S3 bucket "${node.name}" has public access blocking disabled`,
          description: `Public access blocking is disabled on "${node.name}". This is expected for static website hosting and public asset buckets. Confirm this is intentional before treating it as a security issue.`,
          recommendation: `If "${node.name}" is not intentionally public, enable all four S3 Block Public Access settings: BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets.`,
          metadata: { bucketName: node.name, provider: node.provider },
        });
      }
    }
    return findings;
  }
}

export class S3MissingVersioningAnalyzer implements Analyzer {
  name = 'S3MissingVersioningAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'bucket') continue;
      if (!node.versioned) {
        findings.push({
          severity: 'medium',
          issue: `S3 bucket "${node.name}" does not have versioning enabled`,
          description: `"${node.name}" has versioning disabled. Without versioning, accidental deletes or overwrites are unrecoverable. Versioning is required for cross-region replication and Object Lock.`,
          recommendation: `Enable versioning on "${node.name}" via the S3 console or IaC. Consider adding a lifecycle rule to expire old versions and manage storage costs.`,
          metadata: { bucketName: node.name },
        });
      }
    }
    return findings;
  }
}

export class S3UnencryptedAnalyzer implements Analyzer {
  name = 'S3UnencryptedAnalyzer';

  async analyze(graph: SystemGraph): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== 'bucket') continue;
      if (!node.encrypted) {
        findings.push({
          severity: 'medium',
          issue: `S3 bucket "${node.name}" does not have server-side encryption configured`,
          description: `"${node.name}" has no SSE (Server-Side Encryption) configuration. Data at rest is unencrypted. AWS S3 has enabled SSE-S3 by default since January 2023 for new buckets, but older buckets or those without explicit config should be verified.`,
          recommendation: `Enable SSE on "${node.name}" using SSE-S3 (AES-256) or SSE-KMS. Specify the encryption configuration in your IaC to make it explicit.`,
          metadata: { bucketName: node.name },
        });
      }
    }
    return findings;
  }
}
