import * as path from 'path';
import { loadConfig, formatError, writeCache } from '@infrawise/core';
import { extractDynamoMetadata } from '@infrawise/adapters-dynamodb';
import { extractPostgresMetadata } from '@infrawise/adapters-postgres';
import { scanRepository } from '@infrawise/context';
import { buildGraph } from '@infrawise/graph';
import { runAllAnalyzers } from '@infrawise/analyzers';
import {
  GREEN,
  RED,
  BOLD,
  RESET,
  DIM,
  YELLOW,
  CYAN,
  printFinding,
  printSummaryTable,
} from '../utils';

interface AnalyzeOptions {
  config?: string;
  repo?: string;
  noCache?: boolean;
}

function spinner(msg: string): { stop: (success?: boolean) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${CYAN}${frames[i++ % frames.length]}${RESET} ${msg}`);
  }, 80);
  return {
    stop: (success = true) => {
      clearInterval(interval);
      const icon = success ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      process.stdout.write(`\r${icon} ${msg}\n`);
    },
  };
}

export async function runAnalyze(options: AnalyzeOptions = {}): Promise<void> {
  console.log(`${BOLD}Running Infrawise Analysis${RESET}\n`);

  // Load config
  let config;
  try {
    config = loadConfig(options.config);
    console.log(`${GREEN}✓${RESET} Loaded config: ${DIM}${options.config ?? 'infrawise.yaml'}${RESET}`);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }

  const repoPath = options.repo ?? process.cwd();
  const dynamoMeta: Awaited<ReturnType<typeof extractDynamoMetadata>> = [];
  const postgresMeta: Awaited<ReturnType<typeof extractPostgresMetadata>> = [];

  // Extract DynamoDB metadata
  {
    const spin = spinner('Extracting DynamoDB table metadata...');
    try {
      const result = await extractDynamoMetadata(config);
      dynamoMeta.push(...result);
      spin.stop(true);
      console.log(`  ${DIM}Found ${result.length} DynamoDB table(s)${RESET}`);
    } catch (err) {
      spin.stop(false);
      console.warn(`  ${YELLOW}⚠ DynamoDB extraction failed: ${err instanceof Error ? err.message : String(err)}${RESET}`);
      console.warn(`  ${DIM}Continuing without DynamoDB metadata${RESET}`);
    }
  }

  // Extract PostgreSQL metadata
  if (config.postgres?.enabled && config.postgres.connectionString) {
    const spin = spinner('Extracting PostgreSQL schema metadata...');
    try {
      const result = await extractPostgresMetadata(config.postgres.connectionString);
      postgresMeta.push(...result);
      spin.stop(true);
      console.log(`  ${DIM}Found ${result.length} PostgreSQL table(s)${RESET}`);
    } catch (err) {
      spin.stop(false);
      console.warn(`  ${YELLOW}⚠ PostgreSQL extraction failed: ${err instanceof Error ? err.message : String(err)}${RESET}`);
      console.warn(`  ${DIM}Continuing without PostgreSQL metadata${RESET}`);
    }
  }

  // Scan repository
  let operations: import('@infrawise/shared').ExtractedOperation[];
  {
    const spin = spinner(`Scanning repository: ${path.basename(repoPath)}`);
    try {
      operations = await scanRepository(repoPath);
      spin.stop(true);
      console.log(`  ${DIM}Found ${operations.length} database operation(s)${RESET}`);
    } catch (err) {
      spin.stop(false);
      console.warn(`  ${YELLOW}⚠ Repository scan failed: ${err instanceof Error ? err.message : String(err)}${RESET}`);
      operations = [];
    }
  }

  // Build graph
  const spin2 = spinner('Building infrastructure graph...');
  const graph = buildGraph(operations, dynamoMeta, postgresMeta);
  spin2.stop(true);
  console.log(`  ${DIM}${graph.nodes.length} nodes, ${graph.edges.length} edges${RESET}`);

  // Run analyzers
  const spin3 = spinner('Running analyzers...');
  const findings = await runAllAnalyzers(graph);
  spin3.stop(true);

  // Cache results
  writeCache('graph', graph);
  writeCache('findings', findings);
  writeCache('operations', operations);

  // Display results
  console.log('');
  if (findings.length === 0) {
    console.log(`${GREEN}${BOLD}No issues found!${RESET} Your infrastructure looks good.`);
  } else {
    console.log(`${BOLD}Findings${RESET} (${findings.length} total)\n`);
    findings.forEach((finding, i) => printFinding(finding, i));
    printSummaryTable(findings);

    const hasHigh = findings.some((f) => f.severity === 'high');
    if (hasHigh) {
      console.log(`\n${RED}${BOLD}Action required:${RESET} ${RED}High severity issues detected.${RESET}`);
    }
  }

  console.log(`\n${DIM}Results cached in .infrawise/cache/${RESET}`);
  console.log(`Run ${CYAN}infrawise dev${RESET} to explore results via the MCP server.\n`);
}
