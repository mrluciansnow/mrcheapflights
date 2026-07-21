#!/usr/bin/env node
// Safe production deploy. `wrangler pages deploy .` uploads the WHOLE repo dir
// (it ignores .gitignore), which published .dev.vars — leaking
// SESSION_SIGNING_SECRET + Stripe keys. This script instead stages ONLY the
// files that should be world-readable into a clean .dist/ dir and deploys
// that. wrangler.toml stays in the repo root (read from CWD for the D1/AI
// bindings) but is never uploaded.
//
//   npm run deploy
//
// ALLOWLIST, not denylist: anything not listed is never published. Add new
// served files here on purpose.

import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, '.dist');

// Exactly the files/dirs that make up the public site. NOTHING else ships.
const SERVED_FILES = [
  'index.html', '404.html', 'directory.html', 'pipeline.html',
  'privacy.html', 'terms.html',
  'mascot-small.jpg', 'mascot.png',
  '_headers', 'robots.txt',
];
const SERVED_DIRS = ['functions']; // Pages compiles this — not served as static

console.log('🧹 Building clean .dist/ …');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

let staged = 0;
for (const f of SERVED_FILES) {
  const src = join(root, f);
  if (existsSync(src)) { cpSync(src, join(dist, f)); staged++; }
  else console.warn(`   (missing, skipped) ${f}`);
}
for (const d of SERVED_DIRS) {
  const src = join(root, d);
  if (existsSync(src)) { cpSync(src, join(dist, d), { recursive: true }); staged++; }
}
console.log(`   staged ${staged} entries`);

// Hard guard: never let a secrets/config file into the deploy.
for (const forbidden of ['.dev.vars', 'wrangler.toml', 'package.json']) {
  if (existsSync(join(dist, forbidden))) {
    console.error(`💥 ABORT: ${forbidden} ended up in .dist/ — refusing to deploy.`);
    process.exit(1);
  }
}

const branch = process.argv.includes('--preview') ? 'preview' : 'main';
console.log(`🚀 Deploying .dist/ to ${branch} …`);
execSync(
  `npx wrangler pages deploy .dist --project-name=mrcheap --branch=${branch} --commit-dirty=true`,
  { cwd: root, stdio: 'inherit' }
);
console.log('✅ Deployed (clean — no secrets/tooling uploaded).');
