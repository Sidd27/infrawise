import type { Finding, SystemGraph } from '../types.js';

// ─── SQS ─────────────────────────────────────────────────────────────────────

export async function MissingDLQAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];

  // A queue that is another queue's dead-letter target is itself the DLQ —
  // it is not supposed to have one.
  const dlqTargets = new Set<string>();
  for (const node of graph.nodes) {
    if (node.type === 'queue' && node.dlqArn) dlqTargets.add(node.dlqArn.split(':').pop() ?? '');
  }

  for (const node of graph.nodes) {
    if (node.type !== 'queue' || node.placeholder) continue;
    if (dlqTargets.has(node.name)) continue;
    if (!node.hasDLQ) {
      findings.push({
        severity: 'high',
        issue: `Queue "${node.name}" has no Dead Letter Queue`,
        description: `SQS queue "${node.name}" has no redrive policy, so no DLQ captures failures. maxReceiveCount only exists as part of a redrive policy: without one, a message the consumer cannot process becomes visible again after the visibility timeout and is retried until the retention period (${node.retentionDays ?? 4} days) expires, then deleted with no record of it.`,
        recommendation: `Add a Dead Letter Queue to "${node.name}". Set maxReceiveCount to 3–5 retries before routing to DLQ. Alert on DLQ depth.`,
        metadata: { queueName: node.name, provider: node.provider },
      });
    }
  }
  return findings;
}

export async function UnencryptedQueueAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'queue' || node.placeholder) continue;
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

export async function LargeQueueBacklogAnalyzer(
  graph: SystemGraph,
  threshold = 1000,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'queue') continue;
    const count = node.approximateMessages ?? 0;
    if (count > threshold) {
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

export async function VisibilityTimeoutMismatchAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  const lambdaTimeouts = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.type === 'lambda' && node.timeoutSec) {
      lambdaTimeouts.set(node.name, node.timeoutSec);
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== 'queue' || node.visibilityTimeoutSec === undefined) continue;
    const triggeringEdge = graph.edges.find(
      (e) => e.type === 'triggers' && e.from === `queue:aws:${node.name}`,
    );
    if (!triggeringEdge) continue;
    const lambdaName = triggeringEdge.to.replace('lambda:aws:', '');
    const lambdaTimeout = lambdaTimeouts.get(lambdaName);
    if (!lambdaTimeout) continue;

    // Below 1× the messages are guaranteed to be redelivered mid-invocation;
    // between 1× and AWS's recommended 6× a retry burst can still overlap a
    // running invocation, which is a risk rather than a certainty.
    if (node.visibilityTimeoutSec >= lambdaTimeout) {
      if (node.visibilityTimeoutSec < lambdaTimeout * 6) {
        findings.push({
          severity: 'medium',
          issue: `Queue "${node.name}" visibility timeout (${node.visibilityTimeoutSec}s) is less than 6× Lambda "${lambdaName}" timeout (${lambdaTimeout}s)`,
          description: `AWS recommends a visibility timeout of at least 6× the consumer function timeout so retries never overlap an in-flight invocation. At ${node.visibilityTimeoutSec}s a slow invocation plus a retry can process the same message twice.`,
          recommendation: `Set the visibility timeout for "${node.name}" to ${lambdaTimeout * 6}s or more, and make the handler idempotent.`,
          metadata: {
            queueName: node.name,
            visibilityTimeoutSec: node.visibilityTimeoutSec,
            lambdaName,
            lambdaTimeoutSec: lambdaTimeout,
            recommendedVisibilityTimeoutSec: lambdaTimeout * 6,
          },
        });
      }
      continue;
    }

    findings.push({
      severity: 'high',
      issue: `Queue "${node.name}" visibility timeout (${node.visibilityTimeoutSec}s) is less than Lambda "${lambdaName}" timeout (${lambdaTimeout}s)`,
      description: `If the Lambda takes longer than the visibility timeout, SQS will re-deliver the message to another consumer while the original invocation is still running, causing duplicate processing.`,
      recommendation: `Set the visibility timeout for "${node.name}" to at least ${lambdaTimeout * 6}s (6× the Lambda timeout of ${lambdaTimeout}s), per AWS best practice.`,
      metadata: {
        queueName: node.name,
        visibilityTimeoutSec: node.visibilityTimeoutSec,
        lambdaName,
        lambdaTimeoutSec: lambdaTimeout,
        recommendedVisibilityTimeoutSec: lambdaTimeout * 6,
      },
    });
  }
  return findings;
}

// ─── Secrets Manager ─────────────────────────────────────────────────────────

export async function MissingSecretRotationAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'secret' || node.placeholder) continue;
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

// ─── CloudWatch Logs ─────────────────────────────────────────────────────────

export async function MissingLogRetentionAnalyzer(graph: SystemGraph): Promise<Finding[]> {
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

// ─── Lambda ───────────────────────────────────────────────────────────────────

export async function LambdaDefaultMemoryAnalyzer(graph: SystemGraph): Promise<Finding[]> {
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

export async function LambdaMissingTriggerDLQAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'lambda') continue;
    for (const trigger of node.triggers ?? []) {
      if (trigger.type !== 'sqs' && trigger.type !== 'kinesis' && trigger.type !== 'dynamodb')
        continue;
      // Check if there's a DLQ/destination on the trigger edge — we flag if the source queue itself has no DLQ
      // and the trigger is active, since failures will be silently dropped
      const sourceQueue = graph.nodes.find(
        (n) => n.type === 'queue' && n.name === trigger.sourceName,
      );
      if (
        sourceQueue &&
        sourceQueue.type === 'queue' &&
        !sourceQueue.placeholder &&
        !sourceQueue.hasDLQ
      ) {
        findings.push({
          severity: 'high',
          issue: `Lambda "${node.name}" is triggered by "${trigger.sourceName}" which has no DLQ`,
          description: `"${node.name}" receives events from "${trigger.sourceName}" (${trigger.type.toUpperCase()}). If the Lambda handler fails, messages will be retried and eventually discarded with no failure record.`,
          recommendation: `Add a DLQ to "${trigger.sourceName}" and set a destination config on the event source mapping so failed batches are captured and inspectable.`,
          metadata: {
            functionName: node.name,
            triggerSource: trigger.sourceName,
            triggerType: trigger.type,
          },
        });
      }
    }
  }
  return findings;
}

export async function LambdaHighTimeoutAnalyzer(graph: SystemGraph): Promise<Finding[]> {
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

// ─── S3 ──────────────────────────────────────────────────────────────────────

export async function S3PublicAccessAnalyzer(graph: SystemGraph): Promise<Finding[]> {
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

export async function S3MissingVersioningAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'bucket') continue;
    if (node.versioned === false) {
      findings.push({
        severity: 'medium',
        issue: `S3 bucket "${node.name}" does not have versioning enabled`,
        description: `"${node.name}" has versioning disabled. Without versioning, accidental deletes or overwrites are unrecoverable. Versioning is required for cross-region replication and Object Lock.`,
        recommendation: `Enable versioning on "${node.name}" via the S3 console or IaC. Consider adding a lifecycle rule to expire old versions and manage storage costs.`,
        metadata: { bucketName: node.name, provider: node.provider },
      });
    }
  }
  return findings;
}

export async function S3UnencryptedAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'bucket') continue;
    if (node.encrypted === false) {
      findings.push({
        severity: 'medium',
        issue: `S3 bucket "${node.name}" does not have server-side encryption configured`,
        description: `"${node.name}" has no SSE (Server-Side Encryption) configuration. Data at rest is unencrypted. AWS S3 has enabled SSE-S3 by default since January 2023 for new buckets, but older buckets or those without explicit config should be verified.`,
        recommendation: `Enable SSE on "${node.name}" using SSE-S3 (AES-256) or SSE-KMS. Specify the encryption configuration in your IaC to make it explicit.`,
        metadata: { bucketName: node.name, provider: node.provider },
      });
    }
  }
  return findings;
}

// ─── ElastiCache ─────────────────────────────────────────────────────────────

// ─── CloudFront ──────────────────────────────────────────────────────────────

export async function CloudFrontInsecureViewerProtocolAnalyzer(
  graph: SystemGraph,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'distribution' || !node.enabled) continue;
    for (const behavior of node.behaviors ?? []) {
      if (behavior.viewerProtocolPolicy !== 'allow-all') continue;
      findings.push({
        severity: 'medium',
        issue: `CloudFront "${node.name}" serves "${behavior.pathPattern}" over plain HTTP`,
        description: `The behavior matching "${behavior.pathPattern}" on distribution ${node.distributionId} has viewerProtocolPolicy "allow-all", so viewers can reach origin "${behavior.targetOriginId}" over unencrypted HTTP. Any auth header or cookie on those requests crosses the network in plaintext.`,
        recommendation: `Set viewerProtocolPolicy to "redirect-to-https" (or "https-only" for API paths that should never be reachable over HTTP) for "${behavior.pathPattern}".`,
        metadata: {
          distributionId: node.distributionId,
          pathPattern: behavior.pathPattern,
          provider: node.provider,
        },
      });
    }
  }
  return findings;
}

export async function CacheTransitEncryptionAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'cache_cluster') continue;
    if (node.transitEncryption === false) {
      findings.push({
        severity: 'medium',
        issue: `Cache cluster "${node.name}" has no in-transit encryption`,
        description: `ElastiCache cluster "${node.name}" (${node.engine}) does not have TLS in-transit encryption enabled. Credentials and cached data cross the network in plaintext.`,
        recommendation: `Enable transit encryption on "${node.name}". Note this requires clients to connect with TLS (rediss:// for Redis).`,
        metadata: { cacheClusterId: node.name, provider: node.provider },
      });
    }
  }
  return findings;
}

export async function CacheSingleNodeAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'cache_cluster') continue;
    if (node.numNodes === 1 && !node.replicationGroupId) {
      findings.push({
        severity: 'low',
        issue: `Cache cluster "${node.name}" is a single node with no replication`,
        description: `"${node.name}" runs one cache node outside a replication group. A node failure loses all cached data and takes the cache offline until replaced.`,
        recommendation: `Move "${node.name}" into a replication group with at least one replica and automatic failover if cache availability matters for this workload.`,
        metadata: { cacheClusterId: node.name },
      });
    }
  }
  return findings;
}

// ─── Runtime signals ─────────────────────────────────────────────────────────

export async function LambdaThrottlingAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'lambda') continue;
    if ((node.recentThrottles ?? 0) > 0) {
      findings.push({
        severity: 'high',
        issue: `Lambda "${node.name}" was throttled ${node.recentThrottles} time(s) recently`,
        description: `"${node.name}" hit concurrency throttling in the analysis window. Throttled invocations are rejected or delayed; for sync callers this surfaces as errors, for event sources as retries and growing backlogs.`,
        recommendation: `Check reserved/account concurrency for "${node.name}". Raise reserved concurrency, request an account limit increase, or smooth the invoke rate (SQS between producer and Lambda).`,
        metadata: { functionName: node.name, recentThrottles: node.recentThrottles },
      });
    }
  }
  return findings;
}

export async function StaleQueueMessagesAnalyzer(
  graph: SystemGraph,
  thresholdSec = 3600,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'queue') continue;
    const age = node.oldestMessageAgeSec ?? 0;
    if (age > thresholdSec) {
      findings.push({
        severity: 'medium',
        issue: `Queue "${node.name}" has messages older than ${Math.round(age / 3600)} hour(s)`,
        description: `The oldest message in "${node.name}" is ${Math.round(age / 60)} minutes old. Consumers are not keeping up, are failing, or are not running.`,
        recommendation: `Check consumer health for "${node.name}". If a Lambda consumes it, look at its error and throttle counts; if messages are near the retention limit they will be silently dropped.`,
        metadata: { queueName: node.name, oldestMessageAgeSec: age },
      });
    }
  }
  return findings;
}

// ─── IAM ─────────────────────────────────────────────────────────────────────

const MINIMAL_ACTIONS: Record<string, string> = {
  dynamodb:
    'dynamodb:GetItem, dynamodb:PutItem, dynamodb:Query, dynamodb:UpdateItem, dynamodb:DeleteItem',
  secretsmanager: 'secretsmanager:GetSecretValue',
  ssm: 'ssm:GetParameter, ssm:GetParameters, ssm:GetParametersByPath',
  sqs: 'sqs:SendMessage, sqs:ReceiveMessage, sqs:DeleteMessage, sqs:GetQueueAttributes',
  sns: 'sns:Publish',
  s3: 's3:GetObject, s3:PutObject, s3:DeleteObject',
};

export async function LambdaMissingIAMPermissionsAnalyzer(graph: SystemGraph): Promise<Finding[]> {
  const findings: Finding[] = [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const lambda of graph.nodes) {
    if (lambda.type !== 'lambda') continue;
    if (!lambda.allowedServices) continue; // IAM data unavailable — skip
    if (lambda.allowedServices.includes('*')) continue; // AdministratorAccess

    const funcNode = graph.nodes.find((n) => n.type === 'function' && n.name === lambda.name);
    if (!funcNode) continue;

    const needed = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.from !== funcNode.id) continue;
      const target = nodeMap.get(edge.to);
      if (!target) continue;
      if (
        (edge.type === 'query' || edge.type === 'scan') &&
        target.type === 'table' &&
        target.databaseType === 'dynamodb'
      ) {
        needed.add('dynamodb');
      } else if (edge.type === 'reads_secret') {
        needed.add('secretsmanager');
      } else if (edge.type === 'reads_parameter') {
        needed.add('ssm');
      } else if (edge.type === 'publishes_to' && target.type === 'queue') {
        needed.add('sqs');
      } else if (edge.type === 'publishes_to' && target.type === 'topic') {
        needed.add('sns');
      }
    }

    for (const service of needed) {
      if (lambda.allowedServices.includes(service)) continue;
      findings.push({
        severity: 'high',
        issue: `Lambda "${lambda.name}" accesses ${service} but execution role has no ${service} permissions`,
        description: `"${lambda.name}" calls ${service} in code but its IAM execution role (${lambda.roleArn ?? 'unknown'}) has no ${service}:* permissions. This will cause AccessDeniedException at runtime — code passes tests but fails in AWS.`,
        recommendation: `Add ${service} permissions to the execution role for "${lambda.name}". Minimum required: ${MINIMAL_ACTIONS[service] ?? `${service}:*`}.`,
        metadata: { functionName: lambda.name, missingService: service, roleArn: lambda.roleArn },
      });
    }
  }
  return findings;
}
