#!/usr/bin/env node
/* One command that puts the site live and proves it.
 *
 *   npm run release              # production
 *   npm run release -- --preview # the preview branch
 *
 * Getting online multiplayer live took three commands in a fixed order —
 * migrate, deploy, check — and nothing enforced the order or the checking.
 * Every failure so far has been one of those three steps quietly not
 * happening: schema behind the code, code behind the branch, or nobody
 * looking at the result. A green run of this means online actually serves,
 * not that files were uploaded.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW = process.argv.includes('--preview');
const SITE = process.env.SITE_URL ||
  (PREVIEW ? null : 'https://mrcheapflights.ie');

const step = (n, what) => console.log('\n── ' + n + '. ' + what + ' ' + '─'.repeat(Math.max(0, 56 - what.length)));
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

/* ---------------------------------------------------------------- 1 ---
   Schema first, always. Code that reads a table the database does not have
   is the failure mode that took online down: a five-character join code
   nobody could live without turned out to be one every request depended on. */
step(1, 'migrating the database');
sh('node', ['tools/migrate.mjs', '--remote']);

/* ---------------------------------------------------------------- 2 --- */
step(2, 'deploying the site');
sh('node', [join('scripts', 'deploy.mjs'), ...(PREVIEW ? ['--preview'] : [])]);

/* ---------------------------------------------------------------- 3 ---
   A deploy is not finished until the thing it deployed answers. Pages
   propagates in seconds, so a few tries covers it. */
if (!SITE) {
  console.log('\n── 3. health check skipped (no SITE_URL for a preview deploy)');
  process.exit(0);
}
step(3, 'checking ' + SITE + ' is actually serving');

const wait = ms => new Promise(r => setTimeout(r, ms));
let last = null;
for (let i = 1; i <= 6; i++) {
  try {
    const res = await fetch(SITE + '/api/mp/health', { headers: { 'Cache-Control': 'no-cache' } });
    const type = (res.headers.get('content-type') || '').split(';')[0];
    last = { status: res.status, type };
    if (type.includes('json')) {
      const body = await res.json();
      if (body.ok) {
        console.log('\n✅  online is serving');
        console.log('    tables : ' + Object.keys(body.tables || {}).join(', '));
        console.log('    lobbies: ' + (body.openLobbies ?? 0) + ' waiting');
        process.exit(0);
      }
      console.log('  attempt ' + i + ': not ready — ' + (body.error || 'unknown'));
      if (body.missing?.length) console.log('    missing tables: ' + body.missing.join(', '));
    } else {
      console.log('  attempt ' + i + ': ' + res.status + ' ' + (type || 'no content-type') +
                  ' — not the API. The functions did not reach this host.');
    }
  } catch (e) {
    console.log('  attempt ' + i + ': ' + e.message);
  }
  if (i < 6) await wait(5000);
}

console.error('\n❌  ' + SITE + '/api/mp/health never came back ok.');
console.error('    last saw: ' + JSON.stringify(last));
console.error('\n    404 + text/html  the Functions are not deployed to this host.');
console.error('                     Check the deploy above listed functions/ in .dist.');
console.error('    503 + missing[]  step 1 reached a different database than the site reads.');
console.error('                     `npx wrangler whoami` — same account?');
console.error('    anything else    a proxy, a login wall or a parked page answered.');
process.exit(1);
