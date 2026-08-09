import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, createMcpServer, setGraphState } from '../index.js';
import type { SystemGraph, Finding } from '../../types.js';

const emptyGraph: SystemGraph = { nodes: [], edges: [] };

const testGraph: SystemGraph = {
  nodes: [
    { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
    {
      id: 'table:postgres:public.users',
      type: 'table',
      name: 'public.users',
      databaseType: 'postgres',
      columns: [
        { name: 'id', dataType: 'uuid', nullable: false },
        { name: 'email', dataType: 'text', nullable: false },
      ],
      primaryKeys: ['id'],
      foreignKeys: [],
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
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: 'text'; text: string }[];
  };
  return JSON.parse(result.content[0].text);
}

describe('MCP Server — protocol', () => {
  it('lists all 21 tools', async () => {
    const client = await makeClient(emptyGraph, []);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(22);
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
    expect(names).toContain('get_stream_details');
    expect(names).toContain('get_cache_overview');
    expect(names).toContain('get_table_schema');
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
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].file).toBe('handler.ts');
    expect(data.matches[0].accesses).toHaveLength(1);
    expect(data.matches[0].accesses[0].edgeType).toBe('scan');
    expect(data.ambiguous).toBeUndefined();
    expect(data.issues).toHaveLength(1);
    expect(data.issues[0].severity).toBe('high');
  });

  it('analyze_function returns every same-named function, not just the first', async () => {
    const shadowGraph: SystemGraph = {
      nodes: [
        ...testGraph.nodes,
        {
          id: 'function:experiments/handler.ts:getOrder',
          type: 'function',
          name: 'getOrder',
          file: 'experiments/handler.ts',
        },
      ],
      edges: [
        ...testGraph.edges,
        {
          from: 'function:experiments/handler.ts:getOrder',
          to: 'table:postgres:public.users',
          type: 'query',
        },
      ],
    };
    const shadowClient = await makeClient(shadowGraph, testFindings);
    try {
      const data = await callTool(shadowClient, 'analyze_function', { function: 'getOrder' });
      expect(data.ambiguous).toBe(true);
      expect(data.matches).toHaveLength(2);
      expect(data.matches.map((m: { file: string }) => m.file)).toEqual([
        'handler.ts',
        'experiments/handler.ts',
      ]);
      expect(data.matches[1].accesses[0].targetName).toBe('public.users');
    } finally {
      await shadowClient.close();
    }
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

describe('get_table_schema', () => {
  let client: Client;

  beforeEach(async () => {
    client = await makeClient(testGraph, testFindings);
  });

  afterEach(async () => {
    await client.close();
  });

  it('matches short names case-insensitively and returns column details', async () => {
    const res = await callTool(client, 'get_table_schema', { tables: ['USERS'] });
    expect(res.tables[0].found).toBe(true);
    const match = res.tables[0].matches[0];
    expect(match.name).toBe('public.users');
    expect(match.columns).toHaveLength(2);
    expect(match.columns[0].dataType).toBe('uuid');
    expect(match.primaryKeys).toEqual(['id']);
  });

  it('returns found false with suggestions for unknown tables', async () => {
    const res = await callTool(client, 'get_table_schema', { tables: ['user'] });
    expect(res.tables[0].found).toBe(false);
    expect(res.tables[0].suggestions).toContain('public.users');
  });

  it('handles multiple tables in one call', async () => {
    const res = await callTool(client, 'get_table_schema', { tables: ['Orders', 'users'] });
    expect(res.tables).toHaveLength(2);
    expect(res.tables[0].matches[0].databaseType).toBe('dynamodb');
    expect(res.tables[1].matches[0].databaseType).toBe('postgres');
  });
});

describe('get_cloudfront_overview', () => {
  const cdnGraph: SystemGraph = {
    nodes: [
      {
        id: 'api:aws:abc123',
        type: 'api',
        name: 'orders-api',
        provider: 'aws',
        apiType: 'HTTP',
        routes: [],
      },
      {
        id: 'distribution:aws:E123',
        type: 'distribution',
        name: 'front door',
        provider: 'aws',
        distributionId: 'E123',
        domainName: 'd123.cloudfront.net',
        comment: 'front door',
        enabled: true,
        aliases: ['app.example.com'],
        origins: [
          {
            id: 'orders-origin',
            domainName: 'abc123.execute-api.us-east-1.amazonaws.com',
            originType: 'custom',
          },
          { id: 'assets-origin', domainName: 'assets.s3.amazonaws.com', originType: 's3' },
        ],
        behaviors: [
          {
            pathPattern: '/api/*',
            targetOriginId: 'orders-origin',
            viewerProtocolPolicy: 'redirect-to-https',
            cachePolicy: 'CachingDisabled',
            isDefault: false,
          },
          {
            pathPattern: '*',
            targetOriginId: 'assets-origin',
            viewerProtocolPolicy: 'redirect-to-https',
            isDefault: true,
          },
        ],
      },
    ],
    edges: [{ from: 'distribution:aws:E123', to: 'api:aws:abc123', type: 'routes_to' }],
  };

  let client: Client;
  beforeEach(async () => {
    client = await makeClient(cdnGraph, []);
  });
  afterEach(async () => {
    await client.close();
  });

  it('resolves an execute-api origin to the API Gateway name', async () => {
    const res = await callTool(client, 'get_cloudfront_overview');
    expect(res.total).toBe(1);
    const origins = res.distributions[0].origins;
    expect(origins[0].api).toBe('orders-api');
    expect(origins[1].api).toBeUndefined();
    expect(origins[1].originType).toBe('s3');
  });

  it('lists behaviors in match order with the default last', async () => {
    const res = await callTool(client, 'get_cloudfront_overview');
    const behaviors = res.distributions[0].behaviors;
    expect(behaviors.map((b: { pathPattern: string }) => b.pathPattern)).toEqual(['/api/*', '*']);
    expect(behaviors[0].originDomain).toBe('abc123.execute-api.us-east-1.amazonaws.com');
    expect(behaviors[0].cachePolicy).toBe('CachingDisabled');
    expect(behaviors[1].isDefault).toBe(true);
  });
});

describe('MCP Server — fail closed on unread sources', () => {
  const provenance = {
    sources: [
      { service: 'sqs', status: 'failed' as const, error: 'AccessDenied: sqs:ListQueues' },
      { service: 'lambda', status: 'ok' as const },
      { service: 's3', status: 'disabled' as const },
    ],
    region: 'us-east-1',
    profile: 'prod',
  };

  async function clientWithProvenance() {
    setGraphState({ nodes: [], edges: [] }, [], Date.now(), provenance);
    const mcp = createMcpServer();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(clientTransport);
    return c;
  }

  it('marks a tool unavailable when its source failed to extract', async () => {
    const client = await clientWithProvenance();
    try {
      const data = await callTool(client, 'get_queue_details');
      expect(data.unavailable.sources).toEqual([
        { service: 'sqs', status: 'failed', error: 'AccessDenied: sqs:ListQueues' },
      ]);
      expect(data.unavailable.hint).toContain('not read');
      expect(data.queues).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('marks a tool unavailable when its source was never enabled', async () => {
    const client = await clientWithProvenance();
    try {
      const data = await callTool(client, 'get_s3_overview');
      expect(data.unavailable.sources[0].status).toBe('disabled');
    } finally {
      await client.close();
    }
  });

  it('flags a secondary source failing even when the primary one succeeded', async () => {
    setGraphState({ nodes: [], edges: [] }, [], Date.now(), {
      sources: [
        { service: 'kinesis', status: 'ok' },
        { service: 'msk', status: 'failed', error: 'AccessDenied: kafka:ListClusters' },
      ],
    });
    const mcp = createMcpServer();
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await mcp.connect(st);
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(ct);
    try {
      const data = await callTool(c, 'get_stream_details');
      expect(data.unavailable.sources).toEqual([
        { service: 'msk', status: 'failed', error: 'AccessDenied: kafka:ListClusters' },
      ]);
      expect(data.kafkaClusters).toEqual([]);
    } finally {
      await c.close();
    }
  });

  it('does not cry wolf about databases a project never configured', async () => {
    setGraphState({ nodes: [], edges: [] }, [], Date.now(), {
      sources: [
        { service: 'dynamodb', status: 'ok' },
        { service: 'postgres', status: 'disabled' },
        { service: 'mysql', status: 'disabled' },
        { service: 'mongodb', status: 'disabled' },
      ],
    });
    const mcp = createMcpServer();
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await mcp.connect(st);
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(ct);
    try {
      const data = await callTool(c, 'get_table_schema', { tables: ['orders'] });
      expect(data.unavailable).toBeUndefined();
    } finally {
      await c.close();
    }
  });

  it('warns get_table_schema when a database failed, so found:false is not trusted', async () => {
    setGraphState({ nodes: [], edges: [] }, [], Date.now(), {
      sources: [
        { service: 'dynamodb', status: 'ok' },
        { service: 'postgres', status: 'failed', error: 'password authentication failed' },
        { service: 'mysql', status: 'disabled' },
        { service: 'mongodb', status: 'disabled' },
      ],
    });
    const mcp = createMcpServer();
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await mcp.connect(st);
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(ct);
    try {
      const data = await callTool(c, 'get_table_schema', { tables: ['orders'] });
      expect(data.tables[0].found).toBe(false);
      expect(data.unavailable.sources).toEqual([
        { service: 'postgres', status: 'failed', error: 'password authentication failed' },
      ]);
    } finally {
      await c.close();
    }
  });

  it('leaves a healthy source unflagged', async () => {
    const client = await clientWithProvenance();
    try {
      const data = await callTool(client, 'get_lambda_overview');
      expect(data.unavailable).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it('reports failed sources in the overview freshness block', async () => {
    const client = await clientWithProvenance();
    try {
      const data = await callTool(client, 'get_infra_overview');
      expect(data.freshness.incompleteSources).toEqual([
        { service: 'sqs', error: 'AccessDenied: sqs:ListQueues' },
      ]);
      expect(data.freshness.region).toBe('us-east-1');
      expect(data.freshness.profile).toBe('prod');
    } finally {
      await client.close();
    }
  });

  it('claims nothing when the analysis predates provenance tracking', async () => {
    const client = await makeClient(testGraph, testFindings);
    try {
      const data = await callTool(client, 'get_queue_details');
      expect(data.unavailable).toBeUndefined();
      expect(data.freshness?.incompleteSources).toBeUndefined();
    } finally {
      await client.close();
    }
  });
});
