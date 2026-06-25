import { requireAdmin } from '../_lib/auth.js';

// Public: list deals, optionally filtered by region. Mirrors the shape of
// the old in-memory `deals[]` array so the frontend mapping is 1:1.
export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  const region = searchParams.get('region');
  let query = 'SELECT id, flag, route, dates, price, badge, url, expiry, slug, region FROM deals';
  const binds = [];
  if (region) {
    query += ' WHERE region = ?';
    binds.push(region);
  }
  query += ' ORDER BY created_at DESC';
  const stmt = context.env.DB.prepare(query);
  const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
  return Response.json(results);
}

// Admin: create a deal.
export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const body = await context.request.json();
  const { flag, route, dates, price, badge, url, expiry, slug, region } = body;
  if (!route || !price || !slug) {
    return new Response('route, price and slug are required', { status: 400 });
  }

  const result = await context.env.DB.prepare(
    `INSERT INTO deals (flag, route, dates, price, badge, url, expiry, slug, region)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    flag || '✈️', route, dates || '', price, badge || '🔥 Hot',
    url || '#', expiry || null, slug, region || 'ie'
  ).run();

  return Response.json({ id: result.meta.last_row_id }, { status: 201 });
}
