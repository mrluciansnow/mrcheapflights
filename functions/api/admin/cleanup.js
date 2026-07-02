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

  // Rate-limit counters are per-minute and have no timestamp column — wipe all.
  const rl = await context.env.DB.prepare('DELETE FROM kv_rate_limit').run();
  results.rate_limit_purged = rl.changes;

  // Rejected scraped deals older than 30 days
  const rej = await context.env.DB.prepare(
    `DELETE FROM scraped_deals WHERE status='rejected' AND updated_at < unixepoch() - 2592000`
  ).run();
  results.scraped_rejected_purged = rej.changes;

  // Approved scraped deals older than 90 days (already in deals table, safe to remove reference)
  const app = await context.env.DB.prepare(
    `DELETE FROM scraped_deals WHERE status='approved' AND created_at < unixepoch() - 7776000`
  ).run();
  results.scraped_approved_purged = app.changes;

  // Stripe event idempotency rows older than 90 days
  const se = await context.env.DB.prepare(
    `DELETE FROM stripe_events WHERE processed_at < unixepoch() - 7776000`
  ).run();
  results.stripe_events_purged = se.changes;

  return Response.json({ ok: true, ...results });
}
