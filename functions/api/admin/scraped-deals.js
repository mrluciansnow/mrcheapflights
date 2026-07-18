import { requireAdmin } from '../../_lib/auth.js';

// GET /api/admin/scraped-deals?status=pending — list the scraped queue.
//
// Sub-path routes (approve/reject/delete) live under scraped-deals/ — this
// flat file only ever matches /api/admin/scraped-deals exactly, so the POST
// handler that used to parse ids out of the path here was unreachable dead
// code (and the reason manual approve 404'd from day one).

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const url = new URL(context.request.url);
  const status = url.searchParams.get('status') || 'pending';
  const region = url.searchParams.get('region');

  // confidence/dest_type/ai_copy were missing from this SELECT — the UI
  // rendered every deal as "? unenriched" forever, which made bulk-approve
  // find nothing and re-running Enrich reply "nothing_to_enrich".
  let sql = `SELECT id, source_name, source_url, flag, route, dates, price, badge, region, status,
                    confidence, dest_type, ai_copy, raw_snippet, created_at, updated_at
             FROM scraped_deals WHERE status = ?`;
  const params = [status];
  if (region && ['ie', 'uk'].includes(region)) { sql += ' AND region = ?'; params.push(region); }
  sql += ' ORDER BY created_at DESC LIMIT 100';

  const { results } = await context.env.DB.prepare(sql).bind(...params).all();
  return Response.json(results);
}
