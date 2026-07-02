#!/usr/bin/env node
// Publish the current npm release to Smithery as a stdio MCPB bundle.
// Smithery runs no scan stage for stdio bundles — the serverCard in the
// deploy payload is the only source of the tools list shown on the page.
// Usage: pnpm publish-smithery  (after the npm release is live)
// Auth: SMITHERY_TOKEN env var, or falls back to `smithery auth whoami --full`.

import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUALIFIED_NAME = 'pandeysiddharth27/infrawise';
const API = 'https://api.smithery.ai';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version, description } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const token =
  process.env.SMITHERY_TOKEN ??
  execSync('npx -y @smithery/cli@latest auth whoami --full', { encoding: 'utf8' }).match(
    /smry_[\w+/=-]+/,
  )?.[0];
if (!token) {
  console.error('Not logged in. Run: npx @smithery/cli auth login');
  process.exit(1);
}

const npmVersion = execSync('npm view infrawise version', { encoding: 'utf8' }).trim();
if (npmVersion !== version) {
  console.error(`npm has ${npmVersion} but package.json says ${version} — publish to npm first.`);
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), 'infrawise-mcpb-'));
console.log(`Staging ${version} in ${stage}`);
execSync(`npm install infrawise@${version} --omit=dev --no-audit --no-fund`, {
  cwd: stage,
  stdio: 'inherit',
});
rmSync(join(stage, 'package.json'));
rmSync(join(stage, 'package-lock.json'));

const entry = 'node_modules/infrawise/dist/cli/index.js';
const configSchema = {
  type: 'object',
  properties: {
    config_path: {
      type: 'string',
      title: 'Config file path',
      description:
        'Absolute path to your project infrawise.yaml (run `npx infrawise start` to create it)',
      default: 'infrawise.yaml',
    },
  },
  required: [],
};

writeFileSync(
  join(stage, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: '0.2',
      name: 'infrawise',
      display_name: 'Infrawise',
      version,
      description,
      author: { name: 'Siddharth Pandey', url: 'https://github.com/Sidd27' },
      homepage: 'https://sidd27.github.io/infrawise/',
      repository: { type: 'git', url: 'https://github.com/Sidd27/infrawise' },
      license: 'MIT',
      server: {
        type: 'node',
        entry_point: entry,
        mcp_config: {
          command: 'node',
          args: [`\${__dirname}/${entry}`, 'serve', '--stdio', '--config', '${user_config.config_path}'],
        },
      },
      user_config: configSchema.properties.config_path
        ? { config_path: { ...configSchema.properties.config_path, required: false } }
        : {},
    },
    null,
    2,
  ),
);

const bundle = join(stage, `infrawise-${version}.mcpb`);
execSync(`npx -y @anthropic-ai/mcpb pack . ${bundle}`, { cwd: stage, stdio: 'inherit' });

console.log('Extracting tools/list from the staged server...');
const tools = await new Promise((resolve, reject) => {
  const proc = spawn('node', [entry, 'serve', '--stdio'], { cwd: stage });
  let out = '';
  proc.stdout.on('data', (d) => {
    out += d;
    const line = out.split('\n').find((l) => l.includes('"id":2'));
    if (line) {
      proc.kill();
      resolve(JSON.parse(line).result.tools);
    }
  });
  proc.on('error', reject);
  setTimeout(() => reject(new Error('tools/list timed out')), 30_000);
  const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n');
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smithery-publish', version: '1.0' },
    },
  });
  setTimeout(() => {
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  }, 1000);
});
console.log(`${tools.length} tools found`);

const allowed = ['name', 'title', 'description', 'inputSchema', 'outputSchema', 'annotations'];
const payload = {
  type: 'stdio',
  runtime: 'node',
  configSchema,
  serverCard: {
    serverInfo: {
      name: 'infrawise',
      title: 'Infrawise',
      version,
      description,
      websiteUrl: 'https://sidd27.github.io/infrawise/',
    },
    tools: tools.map((t) => Object.fromEntries(allowed.filter((k) => k in t).map((k) => [k, t[k]]))),
  },
};

const form = new FormData();
form.append('payload', JSON.stringify(payload));
form.append('bundle', new Blob([readFileSync(bundle)]), `infrawise-${version}.mcpb`);
const res = await fetch(`${API}/servers/${encodeURIComponent(QUALIFIED_NAME)}/releases`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
const body = await res.json();
if (!res.ok || body.status === 'FAILURE') {
  console.error('Publish failed:', res.status, body);
  process.exit(1);
}
console.log(`Published to Smithery: ${body.status} (release ${body.deploymentId})`);
console.log(`https://smithery.ai/server/${QUALIFIED_NAME}`);
rmSync(stage, { recursive: true, force: true });
