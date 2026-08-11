#!/usr/bin/env node
// Re-parse the pending scraped_deals queue with the CURRENT parser.
//
// Why this exists: candidates scraped before 183b551 were parsed by a version
// that defaulted the origin to Dublin/London whenever its pattern missed, so
// the queue contains routes the source never claimed ("Cork to Lisbon" stored
// as "Dublin → Lisbon"), junk destinations, and prices in the wrong currency.
// Approving those would publish wrong data; deleting them would throw away
// recoverable deals. Each row keeps its raw_snippet, so we can simply parse it
// again properly.
//
//   node scripts/reparse-pending.mjs            # dry run — reports, changes nothing
//   node scripts/reparse-pending.mjs --apply    # writes the corrections
//
// Actions: CORRECT a route the parser resolves differently, REJECT a row the
// parser now refuses (junk/non-flight/unresolvable), KEEP anything unchanged.
// Rejection sets status='rejected' — it never deletes, so it stays auditable
// and reversible.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDealTitle } from '../functions/_lib/scraper.js';
import { wranglerArgv } from '../tools/wrangler-bin.mjs';

const APPLY = process.argv.includes('--apply');
const DB = 'mrcheapflights-prod';
const tmp = mkdtempSync(join(tmpdir(), 'mcf-reparse-'));

// Reads MUST go through --command: --file uploads the SQL and returns
// execution statistics rather than the selected rows.
function d1Query(sql) {
  const out = execFileSync(process.execPath,
    wranglerArgv(['d1', 'execute', DB, '--remote', '--json', '--command', sql]),
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }
  );
  // wrangler interleaves progress lines (which contain their own brackets)
  // with the JSON payload, so try each '[' until one parses cleanly rather
  // than trusting the first.
  for (let i = out.indexOf('['); i !== -1; i = out.indexOf('[', i + 1)) {
    try {
      const v = JSON.parse(out.slice(i));
      if (Array.isArray(v) && v[0] && Array.isArray(v[0].results)) return v;
    } catch { /* not the payload — keep looking */ }
  }
  throw new Error('no JSON payload in wrangler output: ' + out.slice(0, 300));
}

// Writes go through --file so a large batch isn't shell-length limited.
function d1Exec(sql) {
  const file = join(tmp, 'w.sql');
  writeFileSync(file, sql);
  return execFileSync(process.execPath,
    wranglerArgv(['d1', 'execute', DB, '--remote', '--file', file]),
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
}

const esc = (s) => String(s).replace(/'/g, "''");

console.log(`\n🔁 Re-parsing pending queue with the current parser${APPLY ? '' : '  (DRY RUN)'}\n`);

const res = d1Query("SELECT id, route, price, region, raw_snippet FROM scraped_deals WHERE status='pending'", true);
const rows = (res[0] && res[0].results) || [];
console.log(`   ${rows.length} pending candidates\n`);

const corrections = [], rejects = [], kept = [];

for (const r of rows) {
  const snippet = r.raw_snippet || '';
  // raw_snippet was stored as "title — description".
  const [title, ...rest] = snippet.split(' — ');
  const desc = rest.join(' — ');
  const parsed = parseDealTitle(title || snippet, 'https://x', r.region, desc);

  if (!parsed) { rejects.push({ ...r, why: 'parser rejects (junk / non-flight / unresolvable)' }); continue; }
  if (parsed.route !== r.route || parsed.price !== r.price) {
    corrections.push({ ...r, newRoute: parsed.route, newPrice: parsed.price, newDates: parsed.dates, newBadge: parsed.badge });
  } else {
    kept.push(r);
  }
}

console.log(`   ✅ unchanged : ${kept.length}`);
console.log(`   ✏️  corrected : ${corrections.length}`);
console.log(`   🗑  rejected  : ${rejects.length}\n`);

if (corrections.length) {
  console.log('── corrections (stored → reparsed) ──');
  for (const c of corrections.slice(0, 25)) {
    const routeChanged = c.newRoute !== c.route;
    console.log(`   [${c.id}] ${routeChanged ? `${c.route}  →  ${c.newRoute}` : c.route}` +
      (c.newPrice !== c.price ? `   price ${c.price} → ${c.newPrice}` : ''));
  }
  if (corrections.length > 25) console.log(`   … +${corrections.length - 25} more`);
  console.log('');
}

if (rejects.length) {
  console.log('── rejects (sample) ──');
  for (const r of rejects.slice(0, 15)) console.log(`   [${r.id}] ${r.route} ${r.price}`);
  if (rejects.length > 15) console.log(`   … +${rejects.length - 15} more`);
  console.log('');
}

if (!APPLY) {
  console.log('Dry run — nothing written. Re-run with --apply to commit these changes.\n');
  process.exit(0);
}

const stmts = [];
for (const c of corrections) {
  stmts.push(
    `UPDATE scraped_deals SET route='${esc(c.newRoute)}', price='${esc(c.newPrice)}'` +
    (c.newDates ? `, dates='${esc(c.newDates)}'` : '') +
    (c.newBadge ? `, badge='${esc(c.newBadge)}'` : '') +
    // Re-scored from scratch: the old confidence judged a route that has changed.
    `, confidence=NULL, updated_at=unixepoch() WHERE id=${c.id};`
  );
}
for (const r of rejects) {
  stmts.push(`UPDATE scraped_deals SET status='rejected', updated_at=unixepoch() WHERE id=${r.id};`);
}

if (!stmts.length) { console.log('Nothing to change.\n'); process.exit(0); }

console.log(`Applying ${stmts.length} statements …`);
d1Exec(stmts.join('\n'));
console.log('✅ Applied. Corrected rows have confidence=NULL so the next enrich run re-scores them.\n');
