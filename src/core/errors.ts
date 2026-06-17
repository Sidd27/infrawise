export class InfrawiseError extends Error {
  constructor(
    message: string,
    public readonly reasons?: string[],
    public readonly remediation?: string,
  ) {
    super(message);
    this.name = 'InfrawiseError';
  }

  format(): string {
    const lines: string[] = [`\n${this.message}\n`];

    if (this.reasons && this.reasons.length > 0) {
      lines.push('Possible reasons:');
      for (const reason of this.reasons) {
        lines.push(`  - ${reason}`);
      }
      lines.push('');
    }

    if (this.remediation) {
      lines.push(`Run: ${this.remediation}`);
    }

    return lines.join('\n');
  }
}

export class DynamoDBError extends InfrawiseError {
  constructor(details?: string) {
    super(
      'Unable to access DynamoDB.',
      [
        'Insufficient IAM permissions (need dynamodb:ListTables, dynamodb:DescribeTable)',
        'Wrong AWS region configured',
        'DynamoDB endpoint not reachable',
        details ?? 'Unexpected DynamoDB error',
      ],
      'infrawise doctor',
    );
    this.name = 'DynamoDBError';
  }
}

export class PostgresConnectionError extends InfrawiseError {
  constructor(details?: string) {
    super(
      'Unable to connect to PostgreSQL.',
      [
        'Invalid connection string',
        'Security group restrictions',
        'Expired credentials',
        details ?? 'Unexpected PostgreSQL error',
      ],
      'infrawise doctor',
    );
    this.name = 'PostgresConnectionError';
  }
}

export class RepositoryScanError extends InfrawiseError {
  constructor(details?: string) {
    super(
      'Unable to scan repository.',
      [
        'Path does not exist or is not accessible',
        'Not a valid TypeScript project',
        'tsconfig.json not found',
        details ?? 'Unexpected scan error',
      ],
      'infrawise doctor',
    );
    this.name = 'RepositoryScanError';
  }
}

export function formatError(err: unknown): string {
  if (err instanceof InfrawiseError) {
    return err.format();
  }
  if (err instanceof Error) {
    return `\nUnexpected error: ${err.message}\n`;
  }
  return `\nUnexpected error: ${String(err)}\n`;
}
