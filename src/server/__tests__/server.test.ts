import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, setGraphState } from '../index';
import type { SystemGraph, Finding } from '../../types';

type FastifyInstance = ReturnType<typeof createServer>['fastify'];

const emptyGraph: SystemGraph = { nodes: [], edges: [] };

const testGraph: SystemGraph = {
  nodes: [
    { id: 'table:dynamo:Orders', type: 'table', name: 'Orders', databaseType: 'dynamodb' },
    { id: 'table:postgres:public.users', type: 'table', name: 'public.users', databaseType: 'postgres' },
    { id: 'function:handler.ts:getOrder', type: 'function', name: 'getOrder', file: 'handler.ts' },
    { id: 'queue:aws:payments', type: 'queue', name: 'payments', provider: 'aws', hasDLQ: false, encrypted: true },
    { id: 'secret:aws:db-password', type: 'secret', name: 'db-password', provider: 'aws', rotationEnabled: false },
    { id: 'lambda:aws:processor', type: 'lambda', name: 'processor', runtime: 'nodejs20.x', memoryMB: 128, timeoutSec: 30 },
  ],
  edges: [
    { from: 'function:handler.ts:getOrder', to: 'table:dynamo:Orders', type: 'scan' },
  ],
};

const testFindings: Finding[] = [
  { severity: 'high', issue: 'Full table scan', description: 'Scan on Orders', recommendation: 'Use Query', metadata: { functionName: 'getOrder' } },
  { severity: 'medium', issue: 'Missing index', description: 'No index on email', recommendation: 'Add index', metadata: {} },
];

async function mcp(fastify: FastifyInstance, method: string, params?: Record<string, unknown>, id: number | null = 1) {
  const res = await fastify.inject({
    method: 'POST',
    url: '/mcp',
    payload: { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) },
  });
  return { status: res.statusCode, body: res.statusCode === 204 ? null : JSON.parse(res.body) };
}

describe('MCP Server — JSON-RPC', () => {
  let fastify: FastifyInstance;

  beforeEach(() => {
    setGraphState(emptyGraph, []);
    ({ fastify } = createServer(3001));
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('initialize returns protocol version and server info', async () => {
    const { body } = await mcp(fastify, 'initialize');
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('infrawise');
    expect(body.result.capabilities).toHaveProperty('tools');
  });

  it('tools/list returns all 13 tools', async () => {
    const { body } = await mcp(fastify, 'tools/list');
    expect(body.result.tools).toHaveLength(13);
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('get_infra_overview');
    expect(names).toContain('get_graph_summary');
    expect(names).toContain('analyze_function');
    expect(names).toContain('get_log_errors');
  });

  it('tools/call unknown tool returns -32601 error', async () => {
    const { body } = await mcp(fastify, 'tools/call', { name: 'nonexistent_tool', arguments: {} });
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain('nonexistent_tool');
  });

  it('unknown method returns -32601 error', async () => {
    const { body } = await mcp(fastify, 'resources/list');
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain('resources/list');
  });

  it('notifications/initialized with no id returns 204', async () => {
    const { status } = await mcp(fastify, 'notifications/initialized', {}, null);
    expect(status).toBe(204);
  });

  it('notifications/initialized with id returns empty result', async () => {
    const { body } = await mcp(fastify, 'notifications/initialized', {}, 5);
    expect(body.result).toEqual({});
    expect(body.id).toBe(5);
  });

  it('ping returns empty result', async () => {
    const { body } = await mcp(fastify, 'ping', {}, 2);
    expect(body.result).toEqual({});
  });
});

describe('MCP Server — tool results', () => {
  let fastify: FastifyInstance;

  beforeEach(() => {
    setGraphState(testGraph, testFindings);
    ({ fastify } = createServer(3002));
  });

  afterEach(async () => {
    await fastify.close();
  });

  async function callTool(name: string, args: Record<string, unknown> = {}) {
    const res = await fastify.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    const body = JSON.parse(res.body);
    return JSON.parse(body.result.content[0].text);
  }

  it('get_infra_overview returns counts and high findings', async () => {
    const data = await callTool('get_infra_overview');
    expect(data.summary.tables).toBe(2);
    expect(data.summary.functions).toBe(1);
    expect(data.summary.findings.high).toBe(1);
    expect(data.summary.findings.medium).toBe(1);
    expect(data.highFindings).toHaveLength(1);
    expect(data.highFindings[0].issue).toBe('Full table scan');
  });

  it('get_graph_summary returns all nodes and edges', async () => {
    const data = await callTool('get_graph_summary');
    expect(data.nodes).toHaveLength(testGraph.nodes.length);
    expect(data.edges).toHaveLength(1);
    expect(data.summary.scans).toBe(1);
    expect(data.findings).toHaveLength(2);
  });

  it('analyze_function returns accesses and issues for known function', async () => {
    const data = await callTool('analyze_function', { function: 'getOrder' });
    expect(data.found).toBe(true);
    expect(data.accesses).toHaveLength(1);
    expect(data.accesses[0].edgeType).toBe('scan');
    expect(data.issues).toHaveLength(1);
    expect(data.issues[0].severity).toBe('high');
  });

  it('analyze_function returns not found for unknown function', async () => {
    const data = await callTool('analyze_function', { function: 'nonexistent' });
    expect(data.found).toBe(false);
    expect(data.issues).toHaveLength(0);
  });

  it('suggest_gsi returns index definition', async () => {
    const data = await callTool('suggest_gsi', { table: 'Orders', attribute: 'userId' });
    expect(data.table).toBe('Orders');
    expect(data.index.name).toBe('Orders-userId-index');
    expect(data.index.partitionKey).toBe('userId');
    expect(data.found).toBe(true);
  });

  it('suggest_gsi sanitizes special characters in attribute name', async () => {
    const data = await callTool('suggest_gsi', { table: 'T', attribute: 'user.id' });
    expect(data.index.name).toBe('T-user_id-index');
  });

  it('postgres_index_suggestions returns CREATE INDEX SQL', async () => {
    const data = await callTool('postgres_index_suggestions', { table: 'users', column: 'email' });
    expect(data.recommendation).toContain('CREATE INDEX CONCURRENTLY');
    expect(data.recommendation).toContain('idx_users_email');
    expect(data.notes.length).toBeGreaterThan(0);
  });

  it('suggest_mongo_index returns createIndex command', async () => {
    const data = await callTool('suggest_mongo_index', { collection: 'orders', field: 'userId' });
    expect(data.recommendation).toContain('db.orders.createIndex');
    expect(data.recommendation).toContain('userId');
  });

  it('mysql_index_suggestions returns ALTER TABLE SQL', async () => {
    const data = await callTool('mysql_index_suggestions', { table: 'orders', column: 'status' });
    expect(data.recommendation).toContain('ALTER TABLE');
    expect(data.recommendation).toContain('idx_orders_status');
  });

  it('get_queue_details returns queue metadata', async () => {
    const data = await callTool('get_queue_details');
    expect(data.total).toBe(1);
    expect(data.queues[0].name).toBe('payments');
    expect(data.queues[0].encrypted).toBe(true);
    expect(data.queues[0].hasDLQ).toBe(false);
  });

  it('get_secrets_overview includes note about values never returned', async () => {
    const data = await callTool('get_secrets_overview');
    expect(data.note).toContain('never');
    expect(data.secrets[0].name).toBe('db-password');
    expect(data.secrets[0].rotationEnabled).toBe(false);
  });

  it('get_lambda_overview returns function config', async () => {
    const data = await callTool('get_lambda_overview');
    expect(data.lambdas[0].name).toBe('processor');
    expect(data.lambdas[0].memoryMB).toBe(128);
    expect(data.note).toContain('never');
  });

  it('get_log_errors returns empty when no log groups', async () => {
    const data = await callTool('get_log_errors');
    expect(data.logGroups).toHaveLength(0);
  });
});

describe('MCP Server — HTTP endpoints', () => {
  let fastify: FastifyInstance;

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

  it('GET /mcp/tools returns tool list', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/mcp/tools' });
    const body = JSON.parse(res.body);
    expect(body.tools).toHaveLength(13);
    expect(body.tools[0]).toHaveProperty('name');
    expect(body.tools[0]).toHaveProperty('description');
    expect(body.tools[0]).toHaveProperty('inputSchema');
  });
});
