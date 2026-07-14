import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { scanPythonRepository } from '../python';

const hasPython = (() => {
  for (const cmd of ['python3', 'python', 'py']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      // try next
    }
  }
  return false;
})();

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-pyscan-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string) {
  const file = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe.skipIf(!hasPython)('scanPythonRepository — boto3 clients', () => {
  it('detects sqs.send_message with tracked boto3 client', async () => {
    writeFixture(
      'sqs_fix.py',
      `
import boto3

queue_client = boto3.client('sqs')

def enqueue_order(order_id):
    queue_client.send_message(QueueUrl='https://sqs.us-east-1.amazonaws.com/123/order-events', MessageBody=order_id)
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.serviceType === 'sqs');
    expect(op).toBeDefined();
    expect(op?.operationType).toBe('send_message');
    expect(op?.target).toBe('order-events');
    expect(op?.functionName).toBe('enqueue_order');
    expect(path.isAbsolute(op?.filePath ?? '')).toBe(true);
  });

  it('detects sns.publish with ARN target shortened', async () => {
    writeFixture(
      'sns_fix.py',
      `
import boto3

sns = boto3.client('sns')

def notify():
    sns.publish(TopicArn='arn:aws:sns:us-east-1:123:order-notifications', Message='hi')
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.serviceType === 'sns');
    expect(op?.operationType).toBe('publish');
    expect(op?.target).toBe('order-notifications');
  });

  it('detects ssm get_parameter by receiver-name heuristic', async () => {
    writeFixture(
      'ssm_fix.py',
      `
def load_config(ssm_client):
    return ssm_client.get_parameter(Name='/app/db-url')
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.serviceType === 'ssm');
    expect(op?.target).toBe('/app/db-url');
    expect(op?.functionName).toBe('load_config');
  });

  it('detects get_secret_value and lambda invoke', async () => {
    writeFixture(
      'sec_lambda_fix.py',
      `
import boto3

secrets = boto3.client('secretsmanager')
lambda_client = boto3.client('lambda')

def run():
    secrets.get_secret_value(SecretId='db-password')
    lambda_client.invoke(FunctionName='order-processor')
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    expect(ops.find((o) => o.serviceType === 'secretsmanager')?.target).toBe('db-password');
    expect(ops.find((o) => o.serviceType === 'lambda')?.target).toBe('order-processor');
  });

  it('resolves module-level string constants in kwargs', async () => {
    writeFixture(
      'const_fix.py',
      `
import boto3

QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/billing-events'
sqs = boto3.client('sqs')

def bill():
    sqs.send_message(QueueUrl=QUEUE_URL, MessageBody='x')
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.target === 'billing-events');
    expect(op).toBeDefined();
  });

  it('reports <module> for top-level calls and skips syntax-error files', async () => {
    writeFixture(
      'toplevel_fix.py',
      `\nimport boto3\nsqs = boto3.client('sqs')\nsqs.send_message(QueueUrl='top-q', MessageBody='x')\n`,
    );
    writeFixture('broken_fix.py', 'def broken(:\n  pass\n');
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.target === 'top-q');
    expect(op?.functionName).toBe('<module>');
  });

  it('excludes venv and site-packages directories', async () => {
    writeFixture(
      'venv/lib/vendored_fix.py',
      `\nimport boto3\nsqs = boto3.client('sqs')\nsqs.send_message(QueueUrl='vendored-q', MessageBody='x')\n`,
    );
    const ops = await scanPythonRepository(tmpDir);
    expect(ops.find((o) => o.target === 'vendored-q')).toBeUndefined();
  });
});
