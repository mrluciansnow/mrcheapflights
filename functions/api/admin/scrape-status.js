// GET /api/admin/scrape-status — last scraper run summary for the pipeline
// dashboard's source-health display. Admin session or Bearer CRON_SECRET.
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = context.env.CRON_SECRET;
    if (!secret || !provided || provided !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const row = await context.env.DB.prepare(
    "SELECT value FROM settings WHERE key='scrape_last_summary'"
  ).first();

  if (!row?.value) return Response.json({ available: false });

  let summary;
  try { summary = JSON.parse(row.value); } catch { return Response.json({ available: false }); }
  return Response.json({ available: true, ...summary }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
