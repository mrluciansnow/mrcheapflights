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

import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { wranglerArgv } from '../tools/wrangler-bin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, '.dist');

// Exactly the files/dirs that make up the public site. NOTHING else ships.
const SERVED_FILES = [
  'index.html', '404.html', 'directory.html', 'pipeline.html', 'marketing.html',
  'privacy.html', 'terms.html',
  // Croker Flicks. One self-contained file — no assets, no external requests,
  // and its only network calls are same-origin /api/mp/*. The .artifact.html
  // build and selftest.html are deliberately NOT here: they are build outputs
  // and a test harness, not part of the public site.
  'game.html',
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

/* Hard guard the other way: the site is not the site without these. The
   allowlist has already lost game.html once — it was added on one branch and
   the other branch's copy won a merge — and nothing noticed until the game was
   missing from production. A deploy that cannot serve is worth failing. */
const MUST_SHIP = [
  'index.html',
  'game.html',
  'functions/api/mp/health.js',   // online answers here, or it is not online
  'functions/api/mp/duel.js',
  'functions/api/mp/sync/[id].js',
];
for (const required of MUST_SHIP) {
  if (!existsSync(join(dist, required))) {
    console.error(`💥 ABORT: ${required} is missing from .dist/ — this build cannot serve it.`);
    console.error('   Check SERVED_FILES / SERVED_DIRS above.');
    process.exit(1);
  }
}
console.log(`   verified ${MUST_SHIP.length} required entries are present`);

// Hard guard: never let a secrets/config file into the deploy.
for (const forbidden of ['.dev.vars', 'wrangler.toml', 'package.json']) {
  if (existsSync(join(dist, forbidden))) {
    console.error(`💥 ABORT: ${forbidden} ended up in .dist/ — refusing to deploy.`);
    process.exit(1);
  }
}

const branch = process.argv.includes('--preview') ? 'preview' : 'main';
console.log(`🚀 Deploying .dist/ to ${branch} …`);
execFileSync(process.execPath,
  wranglerArgv(['pages', 'deploy', '.dist', '--project-name=mrcheap',
                `--branch=${branch}`, '--commit-dirty=true']),
  { cwd: root, stdio: 'inherit' }
);
console.log('✅ Deployed (clean — no secrets/tooling uploaded).');

// Self-verify. Deploys used to be fire-and-forget: the smoke suite existed but
// only ran when someone remembered, so a regression could sit live unnoticed.
// Skip with --no-verify (useful when deploying a known-red fix).
if (!process.argv.includes('--no-verify') && branch === 'main') {
  console.log('\n🔎 Verifying deployment …');
  // Pages needs a moment to roll new Functions out to the edge.
  await new Promise((r) => setTimeout(r, 20000));
  try {
    execFileSync(process.execPath, ['scripts/smoke.mjs'], { cwd: root, stdio: 'inherit' });
  } catch {
    console.error('\n⚠️  Smoke checks FAILED against production (see above).');
    console.error('   The deploy is live — decide whether to fix forward or roll back:');
    console.error('   npx wrangler pages deployment list --project-name=mrcheap');
    process.exitCode = 1;
  }
}
