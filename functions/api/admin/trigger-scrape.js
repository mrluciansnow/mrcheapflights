import { requireAdmin } from '../../_lib/auth.js';
import { runScraper } from '../../_lib/scraper.js';
import { logOp } from '../../_lib/oplog.js';

// POST /api/admin/trigger-scrape
// Two auth modes:
//   1. Admin session cookie  — browser/admin panel
//   2. Bearer <CRON_SECRET> — external cron service (cron-job.org, GitHub Actions, etc.)
//      Set CRON_SECRET via: wrangler pages secret put CRON_SECRET --project-name mrcheap
export async function onRequestPost(context) {
  const session = await requireAdmin(context);

  if (!session) {
    // Check cron secret as fallback
    const authHeader = context.request.headers.get('Authorization') || '';
    const cronSecret = context.env.CRON_SECRET;
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!cronSecret || !provided || provided !== cronSecret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  try {
    const summary = await runScraper(context.env);
    // Persist the run summary so the pipeline dashboard can show source health.
    try {
      await context.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('scrape_last_summary', ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=unixepoch()`
      ).bind(JSON.stringify({ ...summary, ran_at: Date.now() })).run();
    } catch { /* health display is best-effort — never fail the scrape for it */ }
    await logOp(context.env, 'scrape', summary.errors.length === 0, summary);
    return Response.json(summary);
  } catch (err) {
    await logOp(context.env, 'scrape', false, { error: err.message });
    return Response.json({ error: err.message }, { status: 500 });
  }
}
