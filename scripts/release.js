#!/usr/bin/env node
// Usage:
//   pnpm release patch        → 0.1.2 → 0.1.3
//   pnpm release minor        → 0.1.2 → 0.2.0
//   pnpm release major        → 0.1.2 → 1.0.0
//   pnpm release 1.2.3        → explicit version
//
// Bumps root package.json, commits, tags, and creates a draft GitHub release
// with notes generated from commit messages since the previous tag.

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
const arg = process.argv[2];

if (!arg) {
  console.error('Usage: pnpm release <patch|minor|major|x.y.z>');
  process.exit(1);
}

const pkgPath = resolve(import.meta.dirname, '../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const prev = pkg.version;
const [major, minor, patch] = prev.split('.').map(Number);

let next;
if (arg === 'patch') {
  next = `${major}.${minor}.${patch + 1}`;
} else if (arg === 'minor') {
  next = `${major}.${minor + 1}.0`;
} else if (arg === 'major') {
  next = `${major + 1}.0.0`;
} else if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else {
  console.error(`Invalid argument: "${arg}". Use patch, minor, major, or an explicit x.y.z version.`);
  process.exit(1);
}

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`infrawise: ${prev} → ${next}`);

// ── Bump server.json if it exists (MCP Registry manifest, gitignored) ─────────

const serverJsonPath = resolve(import.meta.dirname, '../server.json');
if (existsSync(serverJsonPath)) {
  const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
  serverJson.version = next;
  if (Array.isArray(serverJson.packages)) {
    for (const pkg of serverJson.packages) pkg.version = next;
  }
  writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + '\n');
  console.log(`server.json: bumped to ${next}`);
}

// ── Regenerate architecture diagram ──────────────────────────────────────────

console.log('\nGenerating architecture diagram...');
execSync('pnpm generate-diagrams', { stdio: 'inherit' });

execSync('git add package.json docs/architecture.svg', { stdio: 'inherit' });
if (existsSync(serverJsonPath)) execSync('git add server.json', { stdio: 'inherit' });
execSync(`git commit -m "chore: release v${next}"`, { stdio: 'inherit' });
execSync(`git tag v${next}`, { stdio: 'inherit' });

// ── Generate release notes from commits since previous tag ────────────────────

const prevTag = `v${prev}`;
let commits;
try {
  commits = execSync(`git log ${prevTag}..HEAD --pretty=format:"%s" --no-merges`, { encoding: 'utf8' })
    .trim().split('\n')
    .filter(l => l && !l.startsWith('chore: release') && !l.startsWith('chore(deps)'));
} catch {
  commits = [];
}

const strip = (prefix, line) => line.replace(new RegExp(`^${prefix}:\\s*`), '');

const features = commits.filter(l => l.startsWith('feat'));
const fixes    = commits.filter(l => l.startsWith('fix'));
const chores   = commits.filter(l => /^(chore|docs|refactor|perf|test)/.test(l));
const other    = commits.filter(l => !l.startsWith('feat') && !l.startsWith('fix') && !/^(chore|docs|refactor|perf|test)/.test(l));

const sections = [];
if (features.length) sections.push(`## What's New\n${features.map(l => `- ${strip('feat(\\w+)?', l)}`).join('\n')}`);
if (fixes.length)    sections.push(`## Bug Fixes\n${fixes.map(l => `- ${strip('fix(\\w+)?', l)}`).join('\n')}`);
if (chores.length)   sections.push(`## Maintenance\n${chores.map(l => `- ${l}`).join('\n')}`);
if (other.length)    sections.push(`## Other\n${other.map(l => `- ${l}`).join('\n')}`);

const notes = sections.length
  ? sections.join('\n\n')
  : `Release v${next}`;

// ── Push commits and tag ──────────────────────────────────────────────────────

console.log('\nPushing to origin...');
execSync(`git push origin main v${next}`, { stdio: 'inherit' });

// ── Create draft GitHub release via gh CLI ────────────────────────────────────

const notesFile = join(tmpdir(), `infrawise-release-${next}.md`);
writeFileSync(notesFile, notes, 'utf8');

const ghResult = spawnSync(
  'gh', ['release', 'create', `v${next}`, '--draft', '--title', `Infrawise v${next}`, '--notes-file', notesFile],
  { stdio: 'inherit' }
);

if (ghResult.status === 0) {
  console.log(`\nDraft release ready — publish it on GitHub to trigger npm publish:`);
  console.log(`  https://github.com/Sidd27/infrawise/releases/tag/v${next}\n`);
} else {
  console.log(`\n(gh release creation failed — create the release manually on GitHub)\n`);
}
