#!/usr/bin/env node
// check-docs.mjs — release gate: version and MCP tool list in the docs must stay
// in sync with the code. Exit 0 = in sync, exit 1 = mismatches printed.
//
// Checks:
//   1. package.json version == server.json version == website softwareVersion
//   2. TOOLS in src/server/index.ts == `### \`name\`` sections in AGENTS.md
//      == `| \`name\` |` rows in README.md == `- \`name\`` bullets in llms.txt
//   3. No tool documented that the server does not register, and vice versa
//   4. The "exposes N tools" count in AGENTS.md matches the real number
//
// Usage: node scripts/check-docs.mjs

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf-8')

const errors = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg) => {
  errors.push(msg)
  console.error(`  ✗ ${msg}`)
}

// ─── 1. Version ──────────────────────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'))
const manifest = JSON.parse(read('server.json'))
const astro = read('website/src/pages/index.astro')
const astroVersion = astro.match(/"softwareVersion"\s*:\s*"([^"]+)"/)?.[1]

const versions = [
  ['package.json', pkg.version],
  ['server.json', manifest.version],
  ['website softwareVersion', astroVersion ?? null],
]
console.log('Version:')
for (const [file, v] of versions) {
  v === pkg.version ? ok(`${file} = ${v}`) : fail(`${file} = ${v} (expected ${pkg.version})`)
}

// ─── 2. Tool list ────────────────────────────────────────────────────────────
const server = read('src/server/index.ts')
const toolsBlock = server.match(/export const TOOLS[\s\S]*?= \[([\s\S]*?)\n\];/)
if (!toolsBlock) fail('src/server/index.ts: TOOLS array not found')
const tools = toolsBlock
  ? [...toolsBlock[1].matchAll(/name:\s*'([a-z0-9_]+)'/g)].map((m) => m[1])
  : []
if (tools.length > 0) ok(`src/server/index.ts: ${tools.length} tools`)

const toolsSet = new Set(tools)

const ag = read('AGENTS.md')
const readme = read('README.md')
const llms = read('llms.txt')

const agSections = [...ag.matchAll(/^### `([a-z0-9_]+)`/gm)].map((m) => m[1])
const readmeRows = [...readme.matchAll(/^\| `([a-z0-9_]+)`/gm)].map((m) => m[1])
const llmsBullets = [...llms.matchAll(/^- `([a-z0-9_]+)`/gm)].map((m) => m[1])
const agCount = ag.match(/exposes (\d+) tools via MCP/)?.[1]

const docs = [
  ['AGENTS.md', agSections],
  ['README.md', readmeRows],
  ['llms.txt', llmsBullets],
]

console.log('Tool list:')
for (const [file, found] of docs) {
  const foundSet = new Set(found)
  const missing = tools.filter((t) => !foundSet.has(t))
  const extra = [...foundSet].filter((t) => !toolsSet.has(t))
  missing.forEach((t) => fail(`${file}: missing tool \`${t}\``))
  extra.forEach((t) => fail(`${file}: tool \`${t}\` not registered in src/server/index.ts`))
  if (found.length !== tools.length && missing.length === 0 && extra.length === 0) {
    fail(`${file}: ${found.length} tool entries, expected ${tools.length}`)
  }
  if (missing.length === 0 && extra.length === 0 && found.length === tools.length) {
    ok(`${file}: ${found.length} tools`)
  }
}

if (agCount) {
  Number(agCount) === tools.length
    ? ok(`AGENTS.md: "exposes ${agCount} tools via MCP"`)
    : fail(`AGENTS.md: "exposes ${agCount} tools via MCP" (expected ${tools.length})`)
}

console.log('')
if (errors.length > 0) {
  console.error(`check:docs failed — ${errors.length} mismatch(es). Run pnpm check:docs before release.`)
  process.exit(1)
}
console.log('check:docs passed — docs are in sync with the code.')
