import { requireAdmin } from '../../_lib/auth.js';
import { runScraper } from '../../_lib/scraper.js';

// POST /api/admin/trigger-scrape
// Manually triggers the deal scraper. Returns a summary of what was found.
export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  try {
    const summary = await runScraper(context.env);
    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
