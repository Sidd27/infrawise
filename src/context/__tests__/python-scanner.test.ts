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

  it('detects ssm get_parameter with Name kwarg', async () => {
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

  it('detects ssm by receiver-name heuristic when kwargs not recognized', async () => {
    writeFixture(
      'ssm_hint_fix.py',
      `
def refresh(ssm_client):
    ssm_client.get_parameters_by_path()
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.functionName === 'refresh' && o.serviceType === 'ssm');
    expect(op).toBeDefined();
    expect(op?.operationType).toBe('get_parameters_by_path');
    expect(op?.target).toBe('unknown');
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
    writeFixture(
      'site-packages/pkg/vendored2_fix.py',
      `\nimport boto3\nsqs = boto3.client('sqs')\nsqs.send_message(QueueUrl='vendored-q2', MessageBody='x')\n`,
    );
    const ops = await scanPythonRepository(tmpDir);
    expect(ops.find((o) => o.target === 'vendored-q')).toBeUndefined();
    expect(ops.find((o) => o.target === 'vendored-q2')).toBeUndefined();
  });
});

describe.skipIf(!hasPython)('scanPythonRepository — DynamoDB', () => {
  it('tracks dynamodb.Table() assignment then table.query()', async () => {
    writeFixture(
      'ddb_resource_fix.py',
      `
import boto3

dynamodb = boto3.resource('dynamodb')
orders = dynamodb.Table('Orders')

def get_orders(user_id):
    return orders.query(KeyConditionExpression='userId = :u')
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.serviceType === 'dynamodb' && o.target === 'Orders');
    expect(op?.operationType).toBe('query');
    expect(op?.functionName).toBe('get_orders');
  });

  it('detects inline dynamodb.Table("x").scan()', async () => {
    writeFixture(
      'ddb_inline_fix.py',
      `
import boto3

def list_users():
    return boto3.resource('dynamodb').Table('Users').scan()
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.serviceType === 'dynamodb' && o.target === 'Users');
    expect(op?.operationType).toBe('scan');
  });

  it('detects client-style get_item(TableName=...)', async () => {
    writeFixture(
      'ddb_client_fix.py',
      `
import boto3

client = boto3.client('dynamodb')

def get_session(sid):
    return client.get_item(TableName='Sessions', Key={'id': {'S': sid}})
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.serviceType === 'dynamodb' && o.target === 'Sessions');
    expect(op?.operationType).toBe('get_item');
  });

  it('does not misclassify session.query() as dynamodb', async () => {
    writeFixture(
      'orm_fix.py',
      `
def list_rows(session):
    return session.query('anything')
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    expect(
      ops.filter((o) => o.serviceType === 'dynamodb' && o.filePath.endsWith('orm_fix.py')),
    ).toHaveLength(0);
  });
});

describe.skipIf(!hasPython)('scanPythonRepository — SQL', () => {
  it('detects cursor.execute with literal SQL as postgres', async () => {
    writeFixture(
      'pg_fix.py',
      `
def fetch_orders(cursor):
    cursor.execute("SELECT * FROM orders WHERE user_id = %s", (1,))
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.serviceType === 'postgres' && o.target === 'orders');
    expect(op?.operationType).toBe('query');
    expect(op?.functionName).toBe('fetch_orders');
  });

  it('classifies mysql by receiver hint', async () => {
    writeFixture(
      'mysql_fix.py',
      `
def save(mysql_conn):
    mysql_conn.execute("INSERT INTO invoices (id) VALUES (1)")
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.serviceType === 'mysql');
    expect(op?.target).toBe('invoices');
  });

  it('resolves SQL from a module constant and f-string', async () => {
    writeFixture(
      'sql_const_fix.py',
      `
TABLE = 'audit_log'
QUERY = f"SELECT * FROM {TABLE} WHERE ts > %s"

def read_audit(cur):
    cur.execute(QUERY)
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.target === 'audit_log');
    expect(op?.serviceType).toBe('postgres');
  });

  it('unwraps sqlalchemy text() and falls back to unknown on dynamic SQL', async () => {
    writeFixture(
      'sqlalchemy_fix.py',
      `
from sqlalchemy import text

def run(session, sql):
    session.execute(text("UPDATE accounts SET x = 1"))
    session.execute(sql)
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const targets = ops
      .filter((o) => o.filePath.endsWith('sqlalchemy_fix.py'))
      .map((o) => o.target)
      .sort();
    expect(targets).toEqual(['accounts', 'unknown']);
  });
});

describe.skipIf(!hasPython)('scanPythonRepository — MongoDB', () => {
  it('detects db.users.find_one as attribute collection', async () => {
    writeFixture(
      'mongo_attr_fix.py',
      `
def get_user(db, uid):
    return db.users.find_one({'_id': uid})
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const op = ops.find((o) => o.serviceType === 'mongodb' && o.target === 'users');
    expect(op?.operationType).toBe('query');
    expect(op?.functionName).toBe('get_user');
  });

  it('detects subscript and tracked collections; find/aggregate are scans', async () => {
    writeFixture(
      'mongo_sub_fix.py',
      `
def setup(db):
    events = db['events']
    events.insert_one({'a': 1})
    db['metrics'].aggregate([])
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    expect(ops.find((o) => o.target === 'events')?.operationType).toBe('query');
    expect(ops.find((o) => o.target === 'metrics')?.operationType).toBe('scan');
  });
});

describe.skipIf(!hasPython)('scanPythonRepository — Kafka', () => {
  it('detects kafka-python producer.send and confluent produce', async () => {
    writeFixture(
      'kafka_prod_fix.py',
      `
def emit(producer):
    producer.send('order-created', b'payload')
    producer.produce('order-updated', b'payload')
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    expect(ops.find((o) => o.target === 'order-created')?.serviceType).toBe('kafka');
    expect(ops.find((o) => o.target === 'order-updated')?.operationType).toBe('produce');
  });

  it('detects consumer.subscribe with a topic list — one op per topic', async () => {
    writeFixture(
      'kafka_cons_fix.py',
      `
def listen(consumer):
    consumer.subscribe(['payments', 'refunds'])
`,
    );
    const ops = await scanPythonRepository(tmpDir);
    const topics = ops
      .filter((o) => o.serviceType === 'kafka' && o.operationType === 'subscribe')
      .map((o) => o.target)
      .sort();
    expect(topics).toEqual(['payments', 'refunds']);
  });
});
