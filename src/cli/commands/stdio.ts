import * as path from 'path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../../server/index.js';
import { loadGraphState, watchCode } from '../mcp-boot.js';

export async function runStdio(configPath?: string): Promise<void> {
  // stdout is reserved for MCP JSON-RPC — every status line goes to stderr,
  // and the auto-analysis runs silent for the same reason.
  const write = (msg: string) => process.stderr.write(`infrawise: ${msg}\n`);
  const config = await loadGraphState(configPath, { ok: () => {}, warn: write }, true);

  if (config) {
    const repoPath = process.cwd();
    watchCode(repoPath, config, path.resolve(configPath ?? 'infrawise.yaml'), {
      onDone: (graph, findings) =>
        write(
          `code graph refreshed from cache (${graph.nodes.length} nodes · ${findings.length} finding(s))`,
        ),
    });
  }

  const mcp = createMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
