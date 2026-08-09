// POST /api/admin/cleanup
// Nightly maintenance pass — purge stale data across all tables.
// Auth: admin session cookie OR Bearer <CRON_SECRET> (same secret as trigger-scrape).
// Cron-job.org schedule: 02:00 UTC daily.
//
// What it cleans:
//   kv_rate_limit  — all rows (per-minute counters, safe to wipe between runs)
//   scraped_deals  — rejected rows older than 30 days, approved rows older than 90 days
//   stripe_events  — idempotency rows older than 90 days

import { requireAdmin } from '../../_lib/auth.js';
import { logOp } from '../../_lib/oplog.js';

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = context.env.CRON_SECRET;
    if (!secret || !provided || provided !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const results = {};
  // D1 run() reports affected rows on meta.changes (top-level .changes is
  // undefined on current wrangler — counts silently vanished from responses).
  const changes = (r) => r?.meta?.changes ?? r?.changes ?? 0;

  // Rate-limit counters are per-minute and have no timestamp column — wipe all.
  const rl = await context.env.DB.prepare('DELETE FROM kv_rate_limit').run();
  results.rate_limit_purged = changes(rl);

  // ── Deal lifecycle: give expired deals a terminal state ─────────────────────
  // `status` and `expiry` were two independent sources of truth for "is this
  // deal live", and they disagreed: 13 rows sat at status='live' while long
  // expired. Every consumer therefore had to remember to AND the expiry check,
  // and a query that forgot it would happily serve a dead fare. Retiring the
  // row makes `status` authoritative, and the expiry filters elsewhere become
  // belt-and-braces rather than load-bearing.
  //
  // A 3-day grace matches the public listing rule in /api/deals, so nothing is
  // retired while the site would still show it. Deal PAGES remain reachable —
  // this only takes the deal out of the live set.
  try {
    const exp = await context.env.DB.prepare(
      `UPDATE deals SET status='expired', updated_at=unixepoch()
       WHERE status='live' AND expiry IS NOT NULL
         AND date(expiry) < date('now', '-3 days')`
    ).run();
    results.deals_retired = changes(exp);
  } catch { /* non-fatal */ }

  // Rejected scraped deals older than 30 days
  const rej = await context.env.DB.prepare(
    `DELETE FROM scraped_deals WHERE status='rejected' AND updated_at < unixepoch() - 2592000`
  ).run();
  results.scraped_rejected_purged = changes(rej);

  // Approved scraped deals older than 90 days (already in deals table, safe to remove reference)
  const app = await context.env.DB.prepare(
    `DELETE FROM scraped_deals WHERE status='approved' AND created_at < unixepoch() - 7776000`
  ).run();
  results.scraped_approved_purged = changes(app);

  // Stripe event idempotency rows older than 90 days
  const se = await context.env.DB.prepare(
    `DELETE FROM stripe_events WHERE processed_at < unixepoch() - 7776000`
  ).run();
  results.stripe_events_purged = changes(se);

  // Operations log older than 30 days
  try {
    const ol = await context.env.DB.prepare(
      `DELETE FROM op_log WHERE created_at < unixepoch() - 2592000`
    ).run();
    results.op_log_purged = changes(ol);
  } catch { /* table may not exist yet on first run after deploy */ }

  // Orphaned generated images (deal deleted, bytes still in D1).
  // ── Images: by far the biggest thing in this database ───────────────────────
  // Measured 2026-08-01: 83 rows holding 74.6 MB — 98% of the entire D1. They
  // are ~900KB base64 blobs, and D1 is a row store queried by everything else,
  // so this bloat taxes every request. Only deals/ orphans were ever purged;
  // dest/ (46 MB) and posters/ had NO cleanup at all.
  // Keys are '<folder>/<id>-<ts>.<ext>' — CAST grabs the leading digits.
  try {
    const oi = await context.env.DB.prepare(
      `DELETE FROM images WHERE key LIKE 'deals/%'
       AND CAST(substr(key, 7) AS INTEGER) NOT IN (SELECT id FROM deals)`
    ).run();
    results.orphan_images_purged = changes(oi);
  } catch { /* images table may not exist yet */ }

  // Posters whose deal is gone.
  try {
    const op = await context.env.DB.prepare(
      `DELETE FROM images WHERE key LIKE 'posters/%'
       AND CAST(substr(key, 9) AS INTEGER) NOT IN (SELECT id FROM deals)`
    ).run();
    results.orphan_posters_purged = changes(op);
  } catch { /* non-fatal */ }

  // Keep only the newest image per destination hub. generateDestinationImage
  // keeps 2 at write time, but nothing ever pruned older generations, so this
  // folder grew to 49 files / 46 MB for ~25 destinations.
  //
  // Grouped in JS on purpose: the key is 'dest/<slug>-<timestamp>.<ext>' and
  // slugs contain hyphens ('dest/cape-town-1754…'), so splitting on the FIRST
  // hyphen in SQL would lump every 'cape-*' destination together and delete
  // live images. Splitting on the LAST hyphen is the correct boundary and
  // there's no portable way to express that in SQLite.
  try {
    const { results: destKeys } = await context.env.DB.prepare(
      `SELECT key, created_at FROM images WHERE key LIKE 'dest/%'`
    ).all();
    const newestBySlug = new Map();
    for (const row of destKeys || []) {
      const slug = row.key.slice(0, row.key.lastIndexOf('-'));   // strip -<ts>.<ext>
      const best = newestBySlug.get(slug);
      if (!best || row.created_at > best.created_at) newestBySlug.set(slug, row);
    }
    const keep = new Set([...newestBySlug.values()].map((r) => r.key));
    const drop = (destKeys || []).filter((r) => !keep.has(r.key)).map((r) => r.key);
    let purged = 0;
    for (let i = 0; i < drop.length; i += 50) {
      const batch = drop.slice(i, i + 50);
      const marks = batch.map(() => '?').join(',');
      const r = await context.env.DB.prepare(
        `DELETE FROM images WHERE key IN (${marks})`
      ).bind(...batch).run();
      purged += changes(r);
    }
    results.stale_dest_images_purged = purged;
  } catch { /* non-fatal */ }

  // Report the remaining footprint so the growth is visible in the digest
  // rather than only discoverable by someone going looking for it.
  try {
    const sz = await context.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(bytes)),0)/1048576 AS mb FROM images`
    ).first();
    results.images_remaining = sz?.n ?? 0;
    results.images_mb = sz?.mb ?? 0;
  } catch { /* non-fatal */ }

  // Click log older than 90 days
  try {
    const ck = await context.env.DB.prepare(
      `DELETE FROM clicks WHERE created_at < unixepoch() - 7776000`
    ).run();
    results.clicks_purged = changes(ck);
  } catch { /* clicks table may not exist yet */ }

  await logOp(context.env, 'cleanup', true, results);
  return Response.json({ ok: true, ...results });
}
