/* Apply the migrations, in order, exactly once each.
 *
 *   node tools/migrate.mjs            # local D1
 *   node tools/migrate.mjs --remote   # production
 *   node tools/migrate.mjs --remote --dry
 *
 * Why this exists: `wrangler d1 execute --file` is a single file and no
 * memory. 0006 and 0007 are written to be safely re-runnable, but 0001-0004
 * are not — they create tables unguarded and insert seed rows — so "just run
 * them all again" corrupts a live database. Something has to remember.
 *
 * `cf_migrations` is that memory. The interesting case is the FIRST run
 * against a database that already has a schema and no memory of how it got
 * one, which is exactly the state production is in right now. Rather than
 * demand a hand-written baseline, the runner looks: if the objects a
 * migration creates are already there, it records it as applied instead of
 * running it. A migration with nothing detectable to probe is assumed
 * applied too, because on an existing database that is the safe assumption
 * and on a fresh one it will have been run in order anyway.
 *
 * The result is one command that is correct on a fresh database and correct
 * on the live one, which is the whole point — the hosting step should not
 * need somebody to work out which files to run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'migrations');
const DB = process.env.CF_D1_NAME || 'mrcheapflights-prod';
const REMOTE = process.argv.includes('--remote');
const DRY = process.argv.includes('--dry');
const WHERE = REMOTE ? '--remote' : '--local';

function wrangler(args) {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', DB, WHERE, ...args],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 << 20 });
}
function query(sql) {
  const out = wrangler(['--json', '--command', sql]);
  // wrangler prints banners around the JSON; take the first array or object
  const at = out.indexOf('[');
  if (at < 0) return [];
  try { return JSON.parse(out.slice(at))[0]?.results || []; } catch { return []; }
}
const run = args => wrangler(REMOTE ? ['--yes', ...args] : args);

/* The objects a file creates, so the runner can ask whether it already has. */
function objectsIn(sql) {
  const out = [];
  const re = /CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi;
  let m;
  while ((m = re.exec(sql))) out.push({ kind: m[1].toLowerCase(), name: m[2] });
  return out;
}

const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
if (!files.length) { console.log('no migrations'); process.exit(0); }

console.log('database : ' + DB + '  (' + (REMOTE ? 'REMOTE — production' : 'local') + ')');
console.log('files    : ' + files.length + (DRY ? '   [dry run]' : ''));

run(['--command',
  'CREATE TABLE IF NOT EXISTS cf_migrations (' +
  'name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL, adopted INTEGER NOT NULL DEFAULT 0)']);

const applied = new Set(query('SELECT name FROM cf_migrations').map(r => r.name));
const existing = new Set(query(
  "SELECT name FROM sqlite_master WHERE type IN ('table','index')").map(r => r.name));

let ran = 0, adopted = 0, skipped = 0;
for (const f of files) {
  if (applied.has(f)) { skipped++; console.log('  --   ' + f + '  (already applied)'); continue; }
  const sql = readFileSync(join(DIR, f), 'utf8');
  const objs = objectsIn(sql);
  /* Already there? Then this file has run before, under a scheme that did
     not write anything down. Record it rather than running it again. */
  const present = objs.length > 0 && objs.every(o => existing.has(o.name));
  const blind = objs.length === 0 && existing.size > 0;
  if (present || blind) {
    adopted++;
    console.log('  ok   ' + f + '  (adopted — ' +
      (present ? 'its tables are already here' : 'nothing to probe on an existing database') + ')');
    if (!DRY) run(['--command',
      "INSERT OR IGNORE INTO cf_migrations (name, applied_at, adopted) VALUES ('" +
      f.replace(/'/g, "''") + "', unixepoch(), 1)"]);
    continue;
  }
  console.log('  ->   ' + f + '  applying…');
  if (DRY) { ran++; continue; }
  run(['--file', join('migrations', f)]);
  run(['--command',
    "INSERT OR IGNORE INTO cf_migrations (name, applied_at, adopted) VALUES ('" +
    f.replace(/'/g, "''") + "', unixepoch(), 0)"]);
  for (const o of objectsIn(sql)) existing.add(o.name);
  ran++;
}

console.log('\napplied ' + ran + ', adopted ' + adopted + ', already recorded ' + skipped);
if (!DRY) {
  const need = ['cf_players', 'cf_matches', 'cf_turns', 'cf_ledger', 'cf_duels', 'cf_kicks'];
  const have = new Set(query(
    "SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name));
  const missing = need.filter(t => !have.has(t));
  if (missing.length) {
    console.log('MISSING: ' + missing.join(', '));
    process.exit(1);
  }
  console.log('every multiplayer table is present — online is ready to serve');
}
