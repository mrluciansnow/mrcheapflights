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
import { rmSync, mkdirSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { wranglerArgv } from '../tools/wrangler-bin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/* THE WHOLE DEPLOY IS BUILT IN ITS OWN ROOT.
 *
 * This used to stage the served files into .dist/ and run
 * `wrangler pages deploy .dist` from the repo. That works for the static
 * files and does nothing whatever for the Functions, because wrangler does
 * not compile the functions/ directory beside the assets you point it at —
 * it compiles the one beside its CONFIG, which is the repo root. Its own
 * error says so: "Failed to build Functions at ./functions".
 *
 * Which meant every guard here was being applied to a directory the Functions
 * build never looked at. A half-finished file sitting untracked in the repo
 * broke the game's deploy three times over, the second and third times
 * through a script that was reporting it had left that very file behind.
 * Verified directly: with a broken file in functions/, `pages deploy .dist`
 * still fails on it; a root that does not contain the file compiles clean.
 *
 * So the deploy now assembles a complete little project of its own —
 * config, functions, assets — and runs wrangler from inside it. Nothing
 * about the working tree can reach the build.
 *
 *   .deploy/
 *     wrangler.toml     a copy, with the output dir pointed at public/
 *     functions/        tracked files only
 *     public/           the served files; this is what gets uploaded
 */
const build = join(root, '.deploy');
const dist = join(build, 'public');

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

console.log('🧹 Building a clean deploy root …');
rmSync(build, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

let staged = 0;
for (const f of SERVED_FILES) {
  const src = join(root, f);
  if (existsSync(src)) { cpSync(src, join(dist, f)); staged++; }
  else console.warn(`   (missing, skipped) ${f}`);
}
/* Directories are staged from GIT, not from the working tree.
 *
 * `functions/` used to be copied wholesale, which meant anything sitting in
 * that folder shipped — including a half-finished file somebody else was
 * mid-way through writing. Pages compiles every function together, so one
 * unresolved import in a file this project has never heard of fails the whole
 * build and takes the game down with it. That happened twice.
 *
 * Tracked files only. A file that is not committed is not part of the project
 * yet, and a deploy should be reproducible from what is in the repository
 * rather than from whatever happens to be on one machine. Modified tracked
 * files still ship as they are on disk — that is what iterating looks like —
 * it is only the untracked ones that are left behind, loudly. */
function trackedUnder(dir) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', dir],
                             { cwd: root, encoding: 'utf8' });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;                      // no git here: fall back to copying it all
  }
}
function untrackedUnder(dir) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard',
                                     '--', dir], { cwd: root, encoding: 'utf8' });
    return out.split('\0').filter(Boolean);
  } catch { return []; }
}
for (const d of SERVED_DIRS) {
  const src = join(root, d);
  if (!existsSync(src)) continue;
  /* functions/ goes beside the assets dir, not inside it: wrangler compiles
     it from the project root, and anything left under public/ would also be
     served as a static file, which is how you publish your own source. */
  const files = trackedUnder(d);
  if (files === null) {
    console.warn(`   (no git — copying all of ${d}/, including anything uncommitted)`);
    cpSync(src, join(build, d), { recursive: true });
    staged++;
    continue;
  }
  for (const f of files) {
    const from = join(root, f);
    if (!existsSync(from)) continue;          // deleted but still in the index
    mkdirSync(dirname(join(build, f)), { recursive: true });
    cpSync(from, join(build, f));
    staged++;
  }
  const skipped = untrackedUnder(d);
  if (skipped.length) {
    console.warn(`   ⚠ left behind ${skipped.length} uncommitted file(s) under ${d}/:`);
    for (const f of skipped.slice(0, 8)) console.warn(`     ${f}`);
    if (skipped.length > 8) console.warn(`     …and ${skipped.length - 8} more`);
    console.warn('     Commit them to deploy them. Until then they cannot break this build.');
  }
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
  'functions/api/mp/ready.js',    // no ready gate means the first kick is lost
  'functions/api/mp/say.js',
  'functions/api/mp/leave.js',
  'functions/api/mp/again.js',
  'functions/api/mp/name.js',
  'functions/api/mp/ice.js',      // no relay config means voice dies on mobile
];
for (const required of MUST_SHIP) {
  const where = required.startsWith('functions/') ? build : dist;
  if (!existsSync(join(where, required))) {
    console.error(`💥 ABORT: ${required} is missing from .dist/ — this build cannot serve it.`);
    console.error('   Check SERVED_FILES / SERVED_DIRS above.');
    process.exit(1);
  }
}
console.log(`   verified ${MUST_SHIP.length} required entries are present`);

/* The config the build runs against: a copy, pointed at public/, sitting
   BESIDE the assets rather than in them. wrangler needs it for the D1 and AI
   bindings and for nodejs_compat; Pages must never serve it. */
writeFileSync(join(build, 'wrangler.toml'),
  readFileSync(join(root, 'wrangler.toml'), 'utf8')
    .replace(/^pages_build_output_dir\s*=.*$/m, 'pages_build_output_dir = "public"'));

// Hard guard: never let a secrets/config file into the part that gets served.
for (const forbidden of ['.dev.vars', 'wrangler.toml', 'package.json', 'functions']) {
  if (existsSync(join(dist, forbidden))) {
    console.error(`💥 ABORT: ${forbidden} ended up in the served directory — refusing to deploy.`);
    process.exit(1);
  }
}

/* Build the root and stop. Lets the staging be inspected, and lets a test
   prove that nothing in the working tree can reach it, without needing
   credentials or uploading anything. */
if (process.argv.includes('--stage-only')) {
  console.log(`\n📦 Staged only. The deploy root is ${build}`);
  process.exit(0);
}

const branch = process.argv.includes('--preview') ? 'preview' : 'main';
console.log(`🚀 Deploying to ${branch} …`);
/* Two failures live below this line and they mean opposite things: wrangler
   refusing to upload (nothing is live, the old build still serves) and the
   smoke suite going red afterwards (the new build IS live and something on it
   is wrong). They used to leave by the same door, so the release script said
   "the deploy IS live" over a build that had never happened. Exit 1 for the
   first, 2 for the second, and let the caller tell the difference. */
try {
  /* from inside the build root — see the note at the top. Run from the repo,
     wrangler compiles the repo's functions/ whatever it is pointed at. */
  execFileSync(process.execPath,
    wranglerArgv(['pages', 'deploy', 'public', '--project-name=mrcheap',
                  `--branch=${branch}`, '--commit-dirty=true']),
    { cwd: build, stdio: 'inherit' }
  );
} catch {
  console.error('\n💥 THE DEPLOY DID NOT HAPPEN. Nothing was uploaded and the');
  console.error('   previous build is still serving. See wrangler\'s errors above —');
  console.error('   an unresolved import anywhere under functions/ fails the whole');
  console.error('   build, including files this change never touched.');
  process.exit(1);
}
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
    console.error('   The deploy IS live — decide whether to fix forward or roll back:');
    console.error('   npx wrangler pages deployment list --project-name=mrcheap');
    process.exitCode = 2;          // live, but red — see the note above
  }
}
