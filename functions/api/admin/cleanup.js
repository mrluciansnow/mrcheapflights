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
  // Keys are 'deals/<id>-<ts>.<ext>' — CAST grabs the leading digits.
  try {
    const oi = await context.env.DB.prepare(
      `DELETE FROM images WHERE key LIKE 'deals/%'
       AND CAST(substr(key, 7) AS INTEGER) NOT IN (SELECT id FROM deals)`
    ).run();
    results.orphan_images_purged = changes(oi);
  } catch { /* images table may not exist yet */ }

  await logOp(context.env, 'cleanup', true, results);
  return Response.json({ ok: true, ...results });
}
