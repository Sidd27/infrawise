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

export class AWSConnectionError extends InfrawiseError {
  constructor(details?: string) {
    super(
      'Unable to connect to AWS.',
      [
        'Invalid or missing AWS credentials',
        'Incorrect AWS profile specified',
        'Network connectivity issues',
        details ?? 'Unexpected AWS error',
      ],
      'infrawise doctor',
    );
    this.name = 'AWSConnectionError';
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

export class ConfigError extends InfrawiseError {
  constructor(details?: string) {
    super(
      'Invalid or missing configuration.',
      [
        'infrawise.yaml not found in current directory',
        'Missing required fields in configuration',
        details ?? 'Unexpected config error',
      ],
      'infrawise start',
    );
    this.name = 'ConfigError';
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
