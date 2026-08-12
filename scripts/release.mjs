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
/* process.execPath, not 'node': on Windows there is no guarantee `node` is the
   one running this, and on a stripped PATH there may be no `node` at all. */
const node = args => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

/* ---------------------------------------------------------------- 1 ---
   Schema first, always. Code that reads a table the database does not have
   is the failure mode that took online down: a five-character join code
   nobody could live without turned out to be one every request depended on. */
step(1, 'migrating the database');
node([join('tools', 'migrate.mjs'), '--remote']);

/* ---------------------------------------------------------------- 2 ---
   The deploy runs its own smoke suite afterwards, and that suite is about the
   WEBSITE — homepage copy, the deals API, guests not being handed fare data.
   A red check there is worth knowing about and is nothing to do with whether
   the online half is serving.

   It used to end the release anyway, which meant an empty region in the deals
   table could hide the answer to "did the thing I just shipped come up?".
   Two different questions, so: remember it, keep going, and fail at the end
   with whichever of them actually went wrong. */
step(2, 'deploying the site');
let siteRed = false;
try {
  node([join('scripts', 'deploy.mjs'), ...(PREVIEW ? ['--preview'] : [])]);
} catch (e) {
  /* Exit 2 means it went live and the site checks are red — a real problem,
     but a different one, and no reason not to go on and ask whether online is
     serving. Anything else means the upload never happened, and carrying on
     to health-check the OLD build would report success for a deploy that did
     not occur. That is exactly what this said the first time it happened. */
  if (e && e.status === 2) {
    siteRed = true;
    console.error('\n⚠️  The site smoke checks came back red (see above).');
    console.error('   The deploy IS live. Carrying on to check the online half,');
    console.error('   which is a separate question — this run will still fail at the end.');
  } else {
    console.error('\n❌  Stopping: nothing was deployed, so there is nothing new to check.');
    console.error('    Whatever was live before still is. Fix the build and run again.');
    process.exit(1);
  }
}

/* ---------------------------------------------------------------- 3 ---
   A deploy is not finished until the thing it deployed answers. Pages
   propagates in seconds, so a few tries covers it. */
if (!SITE) {
  console.log('\n── 3. health check skipped (no SITE_URL for a preview deploy)');
  process.exit(siteRed ? 1 : 0);
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
        if (siteRed) {
          console.error('\n❌  …but the site smoke checks are red. Scroll up for the one');
          console.error('    that failed: it is about the website, not the game.');
          process.exit(1);
        }
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
