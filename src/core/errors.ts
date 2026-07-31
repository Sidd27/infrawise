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

export function formatError(err: unknown): string {
  if (err instanceof InfrawiseError) {
    return err.format();
  }
  if (err instanceof Error) {
    return `\nUnexpected error: ${err.message}\n`;
  }
  return `\nUnexpected error: ${String(err)}\n`;
}
