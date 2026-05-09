import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { scanRepository } from '../index';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-scanner-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string) {
  fs.writeFileSync(path.join(tmpDir, name), content);
}

describe('scanRepository — DynamoDB', () => {
  it('detects SDK v3 QueryCommand', async () => {
    writeFixture('dynamo-v3.ts', `
      async function getOrder(id: string) {
        await client.send(new QueryCommand({ TableName: 'Orders', KeyConditionExpression: 'id = :id' }));
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.target === 'Orders' && o.operationType === 'QueryCommand');
    expect(op).toBeDefined();
    expect(op?.databaseType).toBe('dynamodb');
    expect(op?.functionName).toBe('getOrder');
  });

  it('detects SDK v3 ScanCommand', async () => {
    writeFixture('dynamo-scan.ts', `
      async function listAll() {
        await client.send(new ScanCommand({ TableName: 'Users' }));
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.target === 'Users' && o.operationType === 'ScanCommand');
    expect(op).toBeDefined();
    expect(op?.databaseType).toBe('dynamodb');
  });

  it('detects v2-style dynamo.query()', async () => {
    writeFixture('dynamo-v2.ts', `
      async function getUser() {
        await dynamoDB.query({ TableName: 'Sessions' });
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.target === 'Sessions' && o.databaseType === 'dynamodb');
    expect(op).toBeDefined();
  });
});

describe('scanRepository — PostgreSQL', () => {
  it('detects pool.query() with SELECT', async () => {
    writeFixture('pg-query.ts', `
      async function getUser(id: string) {
        await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.target === 'users' && o.databaseType === 'postgres');
    expect(op).toBeDefined();
    expect(op?.operationType).toBe('query');
  });

  it('detects Prisma findMany()', async () => {
    writeFixture('prisma-query.ts', `
      async function listOrders() {
        return prisma.orders.findMany({ where: { status: 'active' } });
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.target === 'orders' && o.databaseType === 'postgres');
    expect(op).toBeDefined();
    expect(op?.operationType).toBe('findMany');
  });
});

describe('scanRepository — MySQL', () => {
  it('detects mysql.query()', async () => {
    writeFixture('mysql-query.ts', `
      async function getProduct(id: number) {
        await mysql.query('SELECT * FROM products WHERE id = ?', [id]);
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.target === 'products' && o.databaseType === 'mysql');
    expect(op).toBeDefined();
  });
});

describe('scanRepository — MongoDB', () => {
  it('detects db.collection().find()', async () => {
    writeFixture('mongo-find.ts', `
      async function getItems() {
        return db.collection('items').find({ active: true }).toArray();
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.target === 'items' && o.databaseType === 'mongodb');
    expect(op).toBeDefined();
  });

  it('detects db.users.findOne() (property access pattern)', async () => {
    writeFixture('mongo-prop.ts', `
      async function getUser(id: string) {
        return db.users.findOne({ _id: id });
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.databaseType === 'mongodb' && o.target === 'users');
    expect(op).toBeDefined();
  });
});

describe('scanRepository — AWS services', () => {
  it('detects SQS SendMessageCommand', async () => {
    writeFixture('sqs.ts', `
      async function enqueue(body: string) {
        await client.send(new SendMessageCommand({ QueueUrl: 'orders-queue', MessageBody: body }));
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.databaseType === 'sqs' && o.target === 'orders-queue');
    expect(op).toBeDefined();
    expect(op?.functionName).toBe('enqueue');
  });

  it('detects SNS PublishCommand', async () => {
    writeFixture('sns.ts', `
      async function notify() {
        await client.send(new PublishCommand({ TopicArn: 'arn:aws:sns:us-east-1:123:alerts' }));
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.databaseType === 'sns');
    expect(op).toBeDefined();
    expect(op?.target).toBe('alerts');
  });

  it('detects Secrets Manager GetSecretValueCommand', async () => {
    writeFixture('secrets.ts', `
      async function getDbPassword() {
        await client.send(new GetSecretValueCommand({ SecretId: 'prod/db-password' }));
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.databaseType === 'secretsmanager');
    expect(op).toBeDefined();
    expect(op?.target).toContain('db-password');
  });

  it('detects Lambda InvokeCommand', async () => {
    writeFixture('lambda.ts', `
      async function trigger() {
        await client.send(new InvokeCommand({ FunctionName: 'image-processor' }));
      }
    `);
    const ops = await scanRepository(tmpDir);
    const op = ops.find((o) => o.databaseType === 'lambda' && o.target === 'image-processor');
    expect(op).toBeDefined();
  });
});

describe('scanRepository — edge cases', () => {
  it('throws RepositoryScanError for non-existent path', async () => {
    await expect(scanRepository('/tmp/definitely-does-not-exist-xyz')).rejects.toThrow();
  });

  it('returns empty array for directory with no TS files', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infrawise-empty-'));
    try {
      const ops = await scanRepository(emptyDir);
      expect(ops).toEqual([]);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
