import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, formatError, readCache } from '../../core/index.js';
import { createMcpServer, setGraphState } from '../../server/index.js';
import type { SystemGraph, Finding } from '../../types.js';
import { runAnalyze } from './analyze.js';

export async function runStdio(configPath?: string): Promise<void> {
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    process.stderr.write(formatError(err) + '\n');
    process.exit(1);
  }

  const cachedGraph = readCache<SystemGraph>('graph');
  const cachedFindings = readCache<Finding[]>('findings');

  if (cachedGraph && cachedFindings) {
    setGraphState(cachedGraph, cachedFindings, config);
  } else {
    await runAnalyze({ config: configPath });
    const graph = readCache<SystemGraph>('graph') ?? { nodes: [], edges: [] };
    const findings = readCache<Finding[]>('findings') ?? [];
    setGraphState(graph, findings, config);
  }

  const mcp = createMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
