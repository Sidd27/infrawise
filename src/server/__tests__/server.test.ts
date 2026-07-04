import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, createMcpServer, setGraphState } from '../index';
import type { SystemGraph, Finding } from '../../types';

const emptyGraph: SystemGraph = { nodes: [], edges: [] };

const testGraph: SystemGraph = {
  nodes: [
    { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
    {
      id: 'table:postgres:public.users',
      type: 'table',
      name: 'public.users',
      databaseType: 'postgres',
    },
    { id: 'function:handler.ts:getOrder', type: 'function', name: 'getOrder', file: 'handler.ts' },
    {
      id: 'queue:aws:payments',
      type: 'queue',
      name: 'payments',
      provider: 'aws',
      hasDLQ: false,
      encrypted: true,
    },
    {
      id: 'secret:aws:db-password',
      type: 'secret',
      name: 'db-password',
      provider: 'aws',
      rotationEnabled: false,
    },
    {
      id: 'lambda:aws:processor',
      type: 'lambda',
      name: 'processor',
      runtime: 'nodejs20.x',
      memoryMB: 128,
      timeoutSec: 30,
    },
  ],
  edges: [{ from: 'function:handler.ts:getOrder', to: 'table:dynamo:Orders', type: 'scan' }],
};

const testFindings: Finding[] = [
  {
    severity: 'high',
    issue: 'Full table scan',
    description: 'Scan on Orders',
    recommendation: 'Use Query',
    metadata: { functionName: 'getOrder' },
  },
  {
    severity: 'medium',
    issue: 'Missing index',
    description: 'No index on email',
    recommendation: 'Add index',
    metadata: {},
  },
];

async function makeClient(graph: SystemGraph, findings: Finding[]) {
  setGraphState(graph, findings);
  const mcp = createMcpServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
}

describe('MCP Server — protocol', () => {
  it('lists all 18 tools', async () => {
    const client = await makeClient(emptyGraph, []);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(18);
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_infra_overview');
    expect(names).toContain('get_graph_summary');
    expect(names).toContain('analyze_function');
    expect(names).toContain('get_eventbridge_details');
    expect(names).toContain('get_s3_overview');
    expect(names).toContain('get_log_errors');
    expect(names).toContain('get_api_routes');
    expect(names).toContain('get_stack_outputs');
    expect(names).toContain('get_cognito_overview');
    await client.close();
  });

  it('unknown tool returns isError', async () => {
    const client = await makeClient(emptyGraph, []);
    const result = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });
});

describe('MCP Server — tool results', () => {
  let client: Client;

  beforeEach(async () => {
    client = await makeClient(testGraph, testFindings);
  });

  afterEach(async () => {
    await client.close();
  });

  it('get_infra_overview returns counts and high findings', async () => {
    const data = await callTool(client, 'get_infra_overview');
    expect(data.summary.tables).toBe(2);
    expect(data.summary.functions).toBe(1);
    expect(data.summary.findings.high).toBe(1);
    expect(data.summary.findings.medium).toBe(1);
    expect(data.highFindings).toHaveLength(1);
    expect(data.highFindings[0].issue).toBe('Full table scan');
    expect(data.freshness.stale).toBe(false);
    expect(typeof data.freshness.analyzedAt).toBe('string');
    expect(data.freshness.ageSeconds).toBeGreaterThanOrEqual(0);
  });

  it('get_graph_summary returns all nodes and edges', async () => {
    const data = await callTool(client, 'get_graph_summary');
    expect(data.nodes).toHaveLength(testGraph.nodes.length);
    expect(data.edges).toHaveLength(1);
    expect(data.summary.scans).toBe(1);
    expect(data.findings).toHaveLength(2);
  });

  it('analyze_function returns accesses and issues for known function', async () => {
    const data = await callTool(client, 'analyze_function', { function: 'getOrder' });
    expect(data.found).toBe(true);
    expect(data.accesses).toHaveLength(1);
    expect(data.accesses[0].edgeType).toBe('scan');
    expect(data.issues).toHaveLength(1);
    expect(data.issues[0].severity).toBe('high');
  });

  it('analyze_function returns not found for unknown function', async () => {
    const data = await callTool(client, 'analyze_function', { function: 'nonexistent' });
    expect(data.found).toBe(false);
    expect(data.issues).toHaveLength(0);
  });

  it('suggest_gsi returns index definition', async () => {
    const data = await callTool(client, 'suggest_gsi', { table: 'Orders', attribute: 'userId' });
    expect(data.table).toBe('Orders');
    expect(data.index.name).toBe('Orders-userId-index');
    expect(data.index.partitionKey).toBe('userId');
    expect(data.found).toBe(true);
  });

  it('suggest_gsi sanitizes special characters in attribute name', async () => {
    const data = await callTool(client, 'suggest_gsi', { table: 'T', attribute: 'user.id' });
    expect(data.index.name).toBe('T-user_id-index');
  });

  it('suggest_gsi sanitizes special characters in table name', async () => {
    const data = await callTool(client, 'suggest_gsi', { table: 'my table!', attribute: 'id' });
    expect(data.index.name).toBe('my_table_-id-index');
    expect(data.index.name).not.toContain('!');
  });

  it('postgres_index_suggestions returns CREATE INDEX SQL', async () => {
    const data = await callTool(client, 'postgres_index_suggestions', {
      table: 'users',
      column: 'email',
    });
    expect(data.recommendation).toContain('CREATE INDEX CONCURRENTLY');
    expect(data.recommendation).toContain('idx_users_email');
    expect(data.notes.length).toBeGreaterThan(0);
  });

  it('postgres_index_suggestions sanitizes SQL injection in table and column', async () => {
    const data = await callTool(client, 'postgres_index_suggestions', {
      table: 'users; DROP TABLE users; --',
      column: 'email) WHERE 1=1; --',
    });
    // identifier positions must be word-chars only; structural parens/semicolon are fixed template
    expect(data.recommendation).toMatch(/^CREATE INDEX CONCURRENTLY \w+ ON \w+ \(\w+\);$/);
  });

  it('suggest_mongo_index returns createIndex command', async () => {
    const data = await callTool(client, 'suggest_mongo_index', {
      collection: 'orders',
      field: 'userId',
    });
    expect(data.recommendation).toContain('db.orders.createIndex');
    expect(data.recommendation).toContain('userId');
  });

  it('suggest_mongo_index sanitizes injection in collection and field', async () => {
    const data = await callTool(client, 'suggest_mongo_index', {
      collection: 'orders; db.adminCommand({shutdown:1})',
      field: '$where: function()',
    });
    // collection and field identifiers must be word-chars only; structural {}: are fixed template
    expect(data.recommendation).toMatch(/^db\.\w+\.createIndex\(\{ \w+: 1 \}\)$/);
  });

  it('suggest_mongo_index allows dot notation in field names', async () => {
    const data = await callTool(client, 'suggest_mongo_index', {
      collection: 'orders',
      field: 'address.city',
    });
    expect(data.recommendation).toContain('address.city');
  });

  it('mysql_index_suggestions returns ALTER TABLE SQL', async () => {
    const data = await callTool(client, 'mysql_index_suggestions', {
      table: 'orders',
      column: 'status',
    });
    expect(data.recommendation).toContain('ALTER TABLE');
    expect(data.recommendation).toContain('idx_orders_status');
  });

  it('mysql_index_suggestions sanitizes SQL injection in table and column', async () => {
    const data = await callTool(client, 'mysql_index_suggestions', {
      table: 'orders` DROP TABLE orders; --',
      column: 'status) KEY idx2 (evil',
    });
    // identifier positions must be word-chars only; structural parens/semicolon are fixed template
    expect(data.recommendation).toMatch(/^ALTER TABLE \w+ ADD INDEX \w+ \(\w+\);$/);
  });

  it('get_queue_details returns queue metadata', async () => {
    const data = await callTool(client, 'get_queue_details');
    expect(data.total).toBe(1);
    expect(data.queues[0].name).toBe('payments');
    expect(data.queues[0].encrypted).toBe(true);
    expect(data.queues[0].hasDLQ).toBe(false);
  });

  it('get_secrets_overview includes note about values never returned', async () => {
    const data = await callTool(client, 'get_secrets_overview');
    expect(data.note).toContain('never');
    expect(data.secrets[0].name).toBe('db-password');
    expect(data.secrets[0].rotationEnabled).toBe(false);
  });

  it('get_lambda_overview returns function config', async () => {
    const data = await callTool(client, 'get_lambda_overview');
    expect(data.lambdas[0].name).toBe('processor');
    expect(data.lambdas[0].memoryMB).toBe(128);
    expect(data.note).toContain('never');
  });

  it('get_log_errors returns empty when no log groups', async () => {
    const data = await callTool(client, 'get_log_errors');
    expect(data.logGroups).toHaveLength(0);
  });
});

describe('MCP Server — transport lifecycle', () => {
  it('McpServer throws when connect() is called while a transport is still open', async () => {
    // SDK design: connect() is one-shot per instance. Calling it twice without closing
    // first throws — this is what happens with a shared server under concurrent HTTP requests.
    const mcp = createMcpServer();
    const [serverTransport1] = InMemoryTransport.createLinkedPair();
    const [serverTransport2] = InMemoryTransport.createLinkedPair();

    await mcp.connect(serverTransport1);
    await expect(mcp.connect(serverTransport2)).rejects.toThrow(/Already connected/);
  });

  it('fresh McpServer per connection handles multiple sequential connections without error', async () => {
    for (let i = 0; i < 3; i++) {
      const mcp = createMcpServer();
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      await mcp.connect(serverTransport);
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      await client.close();
    }
  });
});

describe('MCP Server — HTTP endpoints', () => {
  let fastify: ReturnType<typeof createServer>['fastify'];

  beforeEach(() => {
    setGraphState(testGraph, testFindings);
    ({ fastify } = createServer(3003));
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('GET /health returns status ok with counts', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.graphNodes).toBe(testGraph.nodes.length);
    expect(body.findings).toBe(testFindings.length);
  });

  it('handles concurrent POST /mcp requests without transport collision', async () => {
    // SDK throws "Already connected to a transport" if connect() is called on a shared
    // McpServer while a prior transport is still open. Concurrent requests expose this.
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fastify.inject({
          method: 'POST',
          url: '/mcp',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          payload: {
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'test', version: '1.0.0' },
            },
            id: i,
          },
        }),
      ),
    );

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
    }
  });
});
