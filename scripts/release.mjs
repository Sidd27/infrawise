#!/usr/bin/env node
// Usage:
//   pnpm release patch        → 0.1.2 → 0.1.3
//   pnpm release minor        → 0.1.2 → 0.2.0
//   pnpm release major        → 0.1.2 → 1.0.0
//   pnpm release 1.2.3        → explicit version
//
// Bumps root package.json, commits, and creates a git tag.
// CI reads the tag and stamps the version on publish — tag is the source of truth.

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];

if (!arg) {
  console.error('Usage: pnpm release <patch|minor|major|x.y.z>');
  process.exit(1);
}

const pkgPath = resolve(__dirname, '../package.json');
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

execSync('git add package.json', { stdio: 'inherit' });
execSync(`git commit -m "chore: release v${next}"`, { stdio: 'inherit' });
execSync(`git tag v${next}`, { stdio: 'inherit' });

// Floating major tag for GitHub Action users (e.g. uses: Sidd27/infrawise@v1)
const majorTag = `v${next.split('.')[0]}`;
try {
  execSync(`git tag -f ${majorTag}`, { stdio: 'inherit' });
} catch {
  // ignore if tag doesn't exist yet
}

console.log(`\nTagged v${next} and ${majorTag}. Push with:\n`);
console.log(`  git push origin main v${next}`);
console.log(`  git push origin ${majorTag} --force\n`);
