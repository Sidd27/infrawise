import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, createMcpServer, setGraphState, setServerConfig } from '../index.js';
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

function sameNameGraph(secondFile: string): SystemGraph {
  return {
    nodes: [
      ...testGraph.nodes,
      {
        id: `function:${secondFile}:getOrder`,
        type: 'function',
        name: 'getOrder',
        file: secondFile,
      },
    ],
    edges: [
      ...testGraph.edges,
      {
        from: `function:${secondFile}:getOrder`,
        to: 'table:postgres:public.users',
        type: 'query',
      },
    ],
  };
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
    // No provenance loaded, so there is no cloud read time to report. Freshness
    // is derived from provenance alone: absent it, the honest answer is "no
    // claim" rather than a timestamp describing when this graph object was built.
    expect(data.dataHealth.analyzedAt).toBeNull();
    expect(data.dataHealth.ageSeconds).toBeNull();
    expect(data.dataHealth.suggestRefresh).toBe(true);
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
      const files = data.matches.map((m: { file: string }) => m.file);
      expect(new Set(files)).toEqual(new Set(['handler.ts', 'experiments/handler.ts']));
    } finally {
      await shadowClient.close();
    }
  });

  it('analyze_function binds to the file given and returns that match alone', async () => {
    const shadowClient = await makeClient(sameNameGraph('experiments/handler.ts'), testFindings);
    try {
      const data = await callTool(shadowClient, 'analyze_function', {
        function: 'getOrder',
        file: 'experiments/handler.ts',
      });
      expect(data.found).toBe(true);
      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].file).toBe('experiments/handler.ts');
      expect(data.matches[0].accesses[0].targetName).toBe('public.users');
      expect(data.ambiguous).toBeUndefined();
    } finally {
      await shadowClient.close();
    }
  });

  it('analyze_function omits accesses entirely from every ambiguous entry', async () => {
    const shadowClient = await makeClient(sameNameGraph('experiments/handler.ts'), testFindings);
    try {
      const data = await callTool(shadowClient, 'analyze_function', { function: 'getOrder' });
      expect(data.ambiguous).toBe(true);
      expect(data.matches).toHaveLength(2);
      for (const match of data.matches) {
        expect(match).not.toHaveProperty('accesses');
      }
    } finally {
      await shadowClient.close();
    }
  });

  it('analyze_function reports an unmatched file instead of falling back to all matches', async () => {
    const shadowClient = await makeClient(sameNameGraph('experiments/handler.ts'), testFindings);
    try {
      const data = await callTool(shadowClient, 'analyze_function', {
        function: 'getOrder',
        file: 'nowhere/handler.ts',
      });
      expect(data.found).toBe(true);
      expect(data.fileMatched).toBe(false);
      expect(data.requestedFile).toBe('nowhere/handler.ts');
      expect(new Set(data.availableFiles)).toEqual(
        new Set(['handler.ts', 'experiments/handler.ts']),
      );
      expect(data).not.toHaveProperty('matches');
      expect(data.ambiguous).toBeUndefined();
    } finally {
      await shadowClient.close();
    }
  });

  it('analyze_function resolves a bare filename against an absolute stored path', async () => {
    const absolute = '/abs/src/handlers/orders.ts';
    const shadowClient = await makeClient(sameNameGraph(absolute), testFindings);
    try {
      const data = await callTool(shadowClient, 'analyze_function', {
        function: 'getOrder',
        file: 'orders.ts',
      });
      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].file).toBe(absolute);
      expect(data.matches[0].accesses[0].targetName).toBe('public.users');
      expect(data.ambiguous).toBeUndefined();

      const partial = await callTool(shadowClient, 'analyze_function', {
        function: 'getOrder',
        file: 'ders.ts',
      });
      expect(partial.fileMatched).toBe(false);
    } finally {
      await shadowClient.close();
    }
  });

  it('analyze_function file binding also selects which Lambda the triggers come from', async () => {
    const trigger = (queue: string) => ({
      type: 'sqs' as const,
      sourceArn: `arn:aws:sqs:us-east-1:1:${queue}`,
      sourceName: queue,
      eventShape: 'event.Records[0].body',
    });
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'function:/abs/orders.ts:handler',
          type: 'function',
          name: 'handler',
          file: '/abs/orders.ts',
        },
        {
          id: 'function:/abs/users.ts:handler',
          type: 'function',
          name: 'handler',
          file: '/abs/users.ts',
        },
        {
          id: 'lambda:aws:processOrders',
          type: 'lambda',
          name: 'processOrders',
          triggers: [trigger('orders')],
        },
        {
          id: 'lambda:aws:processUsers',
          type: 'lambda',
          name: 'processUsers',
          triggers: [trigger('users')],
        },
      ],
      edges: [
        {
          from: 'lambda:aws:processOrders',
          to: 'function:/abs/orders.ts:handler',
          type: 'implemented_by',
          confidence: 'proven',
        },
        {
          from: 'lambda:aws:processUsers',
          to: 'function:/abs/users.ts:handler',
          type: 'implemented_by',
          confidence: 'proven',
        },
      ],
    };
    const shadowClient = await makeClient(graph, []);
    try {
      const bound = await callTool(shadowClient, 'analyze_function', {
        function: 'handler',
        file: 'orders.ts',
      });
      expect(bound.resolvedLambda).toEqual({ lambda: 'processOrders', confidence: 'proven' });
      expect(bound.candidateLambdas).toBeUndefined();
      expect(bound.triggers.map((t: { source: string }) => t.source)).toEqual(['orders']);

      const unbound = await callTool(shadowClient, 'analyze_function', { function: 'handler' });
      expect(unbound.candidateLambdas).toHaveLength(2);
      expect(unbound).not.toHaveProperty('triggers');
    } finally {
      await shadowClient.close();
    }
  });

  it('analyze_function names the Lambdas that were refused a link and why', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'function:/abs/checkout.ts:checkout',
          type: 'function',
          name: 'checkout',
          file: '/abs/checkout.ts',
        },
        {
          id: 'lambda:aws:checkout-handler-prod',
          type: 'lambda',
          name: 'checkout-handler-prod',
          unresolvedLink: { reason: 'multiple_lambdas', candidates: ['checkout-dev'] },
        },
        {
          id: 'lambda:aws:checkout-dev',
          type: 'lambda',
          name: 'checkout-dev',
          unresolvedLink: { reason: 'multiple_lambdas', candidates: ['checkout-handler-prod'] },
        },
        {
          id: 'lambda:aws:unrelated',
          type: 'lambda',
          name: 'unrelated',
          unresolvedLink: { reason: 'no_match', candidates: [] },
        },
      ],
      edges: [],
    };
    const shadowClient = await makeClient(graph, []);
    try {
      const data = await callTool(shadowClient, 'analyze_function', { function: 'checkout' });
      expect(data.unresolvedLambdas).toEqual([
        {
          lambda: 'checkout-handler-prod',
          reason: 'multiple_lambdas',
          candidates: ['checkout-dev'],
        },
        {
          lambda: 'checkout-dev',
          reason: 'multiple_lambdas',
          candidates: ['checkout-handler-prod'],
        },
      ]);
      expect(data.triggers).toEqual([]);

      const overview = await callTool(shadowClient, 'get_lambda_overview');
      const byName = Object.fromEntries(
        overview.lambdas.map((l: { name: string; unresolvedLink?: unknown }) => [
          l.name,
          l.unresolvedLink,
        ]),
      );
      expect(byName['checkout-dev']).toEqual({
        reason: 'multiple_lambdas',
        candidates: ['checkout-handler-prod'],
      });
      expect(byName['unrelated']).toEqual({ reason: 'no_match', candidates: [] });
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

  it('suggest_gsi names the existing index instead of proposing a duplicate', async () => {
    const graph: SystemGraph = {
      nodes: [
        { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
        {
          id: 'index:Orders:Orders-userId-index',
          type: 'index',
          name: 'Orders-userId-index',
          indexType: 'GSI',
          partitionKey: 'userId',
        },
      ],
      edges: [
        { from: 'table:dynamo:Orders', to: 'index:Orders:Orders-userId-index', type: 'uses_index' },
      ],
    };
    const c = await makeClient(graph, []);
    try {
      const data = await callTool(c, 'suggest_gsi', { table: 'Orders', attribute: 'userId' });
      expect(data.alreadyIndexed).toBe(true);
      expect(data.existingIndex.name).toBe('Orders-userId-index');
      expect(data.index).toBeUndefined();
      const other = await callTool(c, 'suggest_gsi', { table: 'Orders', attribute: 'status' });
      expect(other.alreadyIndexed).toBe(false);
      expect(other.index.name).toBe('Orders-status-index');
    } finally {
      await c.close();
    }
  });

  it('analyze_function resolves triggers through the lambda-to-code link', async () => {
    const graph: SystemGraph = {
      nodes: [
        {
          id: 'function:src/handler.ts:processOrder',
          type: 'function',
          name: 'processOrder',
          file: 'src/handler.ts',
        },
        {
          id: 'lambda:aws:payments-prod-processOrder',
          type: 'lambda',
          name: 'payments-prod-processOrder',
          runtime: 'nodejs22.x',
          memoryMB: 512,
          timeoutSec: 30,
          triggers: [
            {
              type: 'sqs',
              sourceName: 'orders',
              sourceArn: 'arn:aws:sqs:us-east-1:1:orders',
              eventShape: 'event.Records[0].body',
            },
          ],
        },
      ],
      edges: [
        {
          from: 'lambda:aws:payments-prod-processOrder',
          to: 'function:src/handler.ts:processOrder',
          type: 'implemented_by',
          confidence: 'proven',
        },
      ],
    };
    const c = await makeClient(graph, []);
    try {
      const data = await callTool(c, 'analyze_function', { function: 'processOrder' });
      expect(data.found).toBe(true);
      expect(data.triggers).toHaveLength(1);
      expect(data.triggers[0].eventShape).toBe('event.Records[0].body');
      expect(data.resolvedLambda.lambda).toBe('payments-prod-processOrder');
      expect(data.resolvedLambda.confidence).toBe('proven');
    } finally {
      await c.close();
    }
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

describe('MCP Server — dataHealth envelope', () => {
  const prov = (extra: Record<string, unknown> = {}) => ({
    sources: [
      { service: 'sqs', status: 'failed' as const, error: 'AccessDenied: sqs:ListQueues' },
      { service: 'lambda', status: 'ok' as const },
      { service: 's3', status: 'disabled' as const },
    ],
    region: 'us-east-1',
    profile: 'prod',
    analyzedAt: Date.now(),
    ...extra,
  });

  async function clientWith(provenance: unknown) {
    setGraphState(testGraph, testFindings, provenance as Parameters<typeof setGraphState>[2]);
    const mcp = createMcpServer();
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await mcp.connect(st);
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(ct);
    return c;
  }

  it('is present on every response with a fixed shape, even when healthy', async () => {
    const client = await clientWith(prov());
    try {
      const data = await callTool(client, 'get_lambda_overview');
      expect(Object.keys(data.dataHealth).sort()).toEqual([
        'ageSeconds',
        'analyzedAt',
        'iac',
        'profile',
        'refreshWith',
        'region',
        'requestedMaxAgeSeconds',
        'sources',
        'suggestRefresh',
        'withinRequestedAge',
      ]);
      expect(data.dataHealth.sources).toEqual([{ service: 'lambda', status: 'ok', error: null }]);
      expect(data.dataHealth.refreshWith).toBe('infrawise analyze');
    } finally {
      await client.close();
    }
  });

  it('reports a failed source rather than an empty list with no explanation', async () => {
    const client = await clientWith(prov());
    try {
      const data = await callTool(client, 'get_queue_details');
      expect(data.dataHealth.sources).toEqual([
        { service: 'sqs', status: 'failed', error: 'AccessDenied: sqs:ListQueues' },
      ]);
      // The cached graph still holds whatever the last good read found. The
      // point is that the caller can see the list is not authoritative.
      expect(data.dataHealth.sources[0].status).toBe('failed');
    } finally {
      await client.close();
    }
  });

  it('names a disabled source instead of suppressing it', async () => {
    const client = await clientWith(prov());
    try {
      const data = await callTool(client, 'get_s3_overview');
      expect(data.dataHealth.sources).toEqual([{ service: 's3', status: 'disabled', error: null }]);
    } finally {
      await client.close();
    }
  });

  it('lists every source for a graph-wide tool', async () => {
    const client = await clientWith(prov());
    try {
      const data = await callTool(client, 'get_infra_overview');
      expect(data.dataHealth.sources.map((s: { service: string }) => s.service)).toEqual([
        'sqs',
        'lambda',
        's3',
      ]);
      expect(data.freshness).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it('suggests a refresh past 6h, not before', async () => {
    const fresh = await clientWith(prov({ analyzedAt: Date.now() - 5 * 3600_000 }));
    try {
      expect((await callTool(fresh, 'get_queue_details')).dataHealth.suggestRefresh).toBe(false);
    } finally {
      await fresh.close();
    }
    const old = await clientWith(prov({ analyzedAt: Date.now() - 7 * 3600_000 }));
    try {
      expect((await callTool(old, 'get_queue_details')).dataHealth.suggestRefresh).toBe(true);
    } finally {
      await old.close();
    }
  });

  it('reports the configured cloudwatchLogs window, not a fixed 24', async () => {
    setServerConfig({ project: 'test', cloudwatchLogs: { enabled: true, windowHours: 6 } });
    const client = await clientWith(prov());
    try {
      // The adapter scans this window; a hardcoded 24 here would state a window
      // nobody used, and an agent reasoning about error rates divides by it.
      expect((await callTool(client, 'get_log_errors')).windowHours).toBe(6);
    } finally {
      await client.close();
      setServerConfig({ project: 'test' });
    }
  });

  it('honours a configured suggestRefreshAfterHours, then restores the default', async () => {
    setServerConfig({ project: 'test', freshness: { suggestRefreshAfterHours: 1 } });
    const client = await clientWith(prov({ analyzedAt: Date.now() - 2 * 3600_000 }));
    try {
      expect((await callTool(client, 'get_queue_details')).dataHealth.suggestRefresh).toBe(true);
    } finally {
      await client.close();
      // A config with no freshness key: restores the default without also
      // marking the server unconfigured for the tests that follow.
      setServerConfig({ project: 'test' });
    }
    const still = await clientWith(prov({ analyzedAt: Date.now() - 2 * 3600_000 }));
    try {
      expect((await callTool(still, 'get_queue_details')).dataHealth.suggestRefresh).toBe(false);
    } finally {
      await still.close();
    }
  });

  it('reports the cloud read time, not the time the graph was rebuilt', async () => {
    const readAt = Date.now() - 4 * 3600_000;
    const client = await clientWith(prov({ analyzedAt: readAt }));
    try {
      const data = await callTool(client, 'get_queue_details');
      expect(data.dataHealth.ageSeconds).toBeGreaterThanOrEqual(4 * 3600 - 5);
      expect(new Date(data.dataHealth.analyzedAt).getTime()).toBeCloseTo(readAt, -4);
    } finally {
      await client.close();
    }
  });

  it('answers withinRequestedAge against the caller-supplied tolerance', async () => {
    const client = await clientWith(prov({ analyzedAt: Date.now() - 600_000 }));
    try {
      const strict = await callTool(client, 'get_queue_details', { maxAgeSeconds: 60 });
      expect(strict.dataHealth.requestedMaxAgeSeconds).toBe(60);
      expect(strict.dataHealth.withinRequestedAge).toBe(false);
      const loose = await callTool(client, 'get_queue_details', { maxAgeSeconds: 86400 });
      expect(loose.dataHealth.withinRequestedAge).toBe(true);
      const none = await callTool(client, 'get_queue_details');
      expect(none.dataHealth.requestedMaxAgeSeconds).toBeNull();
      expect(none.dataHealth.withinRequestedAge).toBeNull();
    } finally {
      await client.close();
    }
  });

  it('claims nothing when the cache predates provenance', async () => {
    const client = await clientWith(null);
    try {
      const data = await callTool(client, 'get_queue_details');
      expect(data.dataHealth.sources).toEqual([]);
      expect(data.dataHealth.iac.status).toBe('unknown');
      expect(data.dataHealth.iac.reason).toContain('predates');
      expect(data.dataHealth.suggestRefresh).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('marks every graph node with its source and that source status', async () => {
    const client = await clientWith(prov());
    try {
      const data = await callTool(client, 'get_graph_summary');
      const queue = data.nodes.find((n: { type: string }) => n.type === 'queue');
      const lambda = data.nodes.find((n: { type: string }) => n.type === 'lambda');
      expect(queue.source).toBe('sqs');
      expect(queue.sourceStatus).toBe('failed');
      expect(lambda.source).toBe('lambda');
      expect(lambda.sourceStatus).toBe('ok');
    } finally {
      await client.close();
    }
  });
});

describe('MCP Server — cdk.out synth detection', () => {
  const mkCdkOut = (mtime: number) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdkout-'));
    const file = path.join(dir, 'PaymentsStack.template.json');
    fs.writeFileSync(file, '{}');
    fs.utimesSync(file, new Date(mtime), new Date(mtime));
    return dir;
  };

  async function clientWith(provenance: unknown) {
    setGraphState(testGraph, testFindings, provenance as Parameters<typeof setGraphState>[2]);
    const mcp = createMcpServer();
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await mcp.connect(st);
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(ct);
    return c;
  }

  it('reports changed when a template was synthed after the analysis', async () => {
    const analyzedAt = Date.now() - 3600_000;
    const client = await clientWith({
      sources: [],
      analyzedAt,
      cdkOutDir: mkCdkOut(Date.now()),
    });
    try {
      const iac = (await callTool(client, 'get_stack_outputs')).dataHealth.iac;
      expect(iac.status).toBe('changed');
      expect(iac.synthedAt).not.toBeNull();
      expect(new Date(iac.analyzedAt).getTime()).toBeCloseTo(analyzedAt, -4);
    } finally {
      await client.close();
    }
  });

  it('reports unchanged with both operands when nothing was synthed since', async () => {
    const client = await clientWith({
      sources: [],
      analyzedAt: Date.now(),
      cdkOutDir: mkCdkOut(Date.now() - 3600_000),
    });
    try {
      const iac = (await callTool(client, 'get_stack_outputs')).dataHealth.iac;
      expect(iac.status).toBe('unchanged');
      expect(iac.synthedAt).not.toBeNull();
      expect(iac.analyzedAt).not.toBeNull();
      expect(iac.reason).toBeNull();
    } finally {
      await client.close();
    }
  });

  it('reports unknown with a reason when cdk.out is absent, never unchanged', async () => {
    const client = await clientWith({
      sources: [],
      analyzedAt: Date.now(),
      cdkOutDir: path.join(os.tmpdir(), 'definitely-not-here'),
    });
    try {
      const iac = (await callTool(client, 'get_stack_outputs')).dataHealth.iac;
      expect(iac.status).toBe('unknown');
      expect(iac.reason).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  it('reports unknown when the project has no cdk.out recorded', async () => {
    const client = await clientWith({ sources: [], analyzedAt: Date.now() });
    try {
      const iac = (await callTool(client, 'get_stack_outputs')).dataHealth.iac;
      expect(iac.status).toBe('unknown');
      expect(iac.reason).toContain('no cdk.out');
    } finally {
      await client.close();
    }
  });
});
