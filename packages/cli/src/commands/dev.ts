import { loadConfig, formatError, readCache } from '@infrawise/core';
import { createServer, setGraphState } from '@infrawise/server';
import type { SystemGraph, Finding } from '@infrawise/shared';
import { GREEN, BOLD, RESET, DIM, CYAN, YELLOW } from '../utils';

interface DevOptions {
  config?: string;
  port?: number;
}

export async function runDev(options: DevOptions = {}): Promise<void> {
  const port = options.port ?? 3000;

  console.log(`${BOLD}Starting Infrawise MCP Server${RESET}\n`);

  // Load config
  let config;
  try {
    config = loadConfig(options.config);
    console.log(`${GREEN}✓${RESET} Loaded config: ${DIM}${options.config ?? 'infrawise.yaml'}${RESET}`);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }

  // Load cached graph and findings if available
  const cachedGraph = readCache<SystemGraph>('graph');
  const cachedFindings = readCache<Finding[]>('findings');

  if (cachedGraph && cachedFindings) {
    console.log(`${GREEN}✓${RESET} Loaded cached graph (${cachedGraph.nodes.length} nodes, ${cachedGraph.edges.length} edges)`);
    console.log(`${GREEN}✓${RESET} Loaded ${cachedFindings.length} cached findings`);
    setGraphState(cachedGraph, cachedFindings);
  } else {
    console.log(`${YELLOW}⚠${RESET} No cached analysis found. Run ${CYAN}infrawise analyze${RESET} first for full results.`);
    console.log(`${DIM}  Starting server with empty graph...${RESET}`);
    setGraphState({ nodes: [], edges: [] }, []);
  }

  console.log('');

  // Start the server
  const { start } = createServer(port);
  await start();

  console.log(`\n${GREEN}${BOLD}MCP Server is running!${RESET}`);
  console.log(`\n  ${BOLD}Endpoints:${RESET}`);
  console.log(`  ${CYAN}POST http://localhost:${port}/mcp${RESET}        — MCP tool calls`);
  console.log(`  ${CYAN}GET  http://localhost:${port}/mcp/tools${RESET}   — List available tools`);
  console.log(`  ${CYAN}GET  http://localhost:${port}/health${RESET}       — Health check`);
  console.log(`\n  ${BOLD}Example:${RESET}`);
  console.log(`  ${DIM}curl -X POST http://localhost:${port}/mcp \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"tool": "get_graph_summary", "input": {}}'${RESET}`);
  console.log(`\nPress Ctrl+C to stop.\n`);

  // Keep process alive
  process.on('SIGINT', () => {
    console.log(`\n${DIM}Shutting down MCP server...${RESET}`);
    process.exit(0);
  });

  // Block forever
  await new Promise<never>(() => {});
}
