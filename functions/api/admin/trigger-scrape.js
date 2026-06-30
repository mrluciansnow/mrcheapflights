import { requireAdmin } from '../../_lib/auth.js';
import { runScraper } from '../../_lib/scraper.js';

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
    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
