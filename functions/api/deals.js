import { requireAdmin } from '../_lib/auth.js';

// Public: list live deals, optionally filtered by region. Mirrors the shape
// of the old in-memory `deals[]` array so the frontend mapping is 1:1.
// Admins (valid session cookie) see every status, including drafts staged
// in the content pipeline, plus the pipeline_style/pipeline_copy columns.
export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  const { searchParams } = new URL(context.request.url);
  const region = searchParams.get('region');

  const columns = session
    ? 'id, flag, route, dates, price, badge, url, expiry, slug, region, status, pipeline_style, pipeline_copy, was_price, airline, dest_type'
    : 'id, flag, route, dates, price, badge, url, expiry, slug, region';
  let query = `SELECT ${columns} FROM deals`;
  const conditions = [];
  const binds = [];
  if (!session) conditions.push(`status = 'live'`);
  if (region) {
    conditions.push('region = ?');
    binds.push(region);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';

  const stmt = context.env.DB.prepare(query);
  const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
  return Response.json(results);
}

// Admin: create a deal. Defaults to 'live' (the existing CMS behaviour) --
// the content pipeline explicitly passes status:'draft' for candidate deals.
export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const body = await context.request.json();
  const { flag, route, dates, price, badge, url, expiry, slug, region, status, wasPrice, airline, destType } = body;
  if (!route || !price || !slug) {
    return new Response('route, price and slug are required', { status: 400 });
  }

  const result = await context.env.DB.prepare(
    `INSERT INTO deals (flag, route, dates, price, badge, url, expiry, slug, region, status, was_price, airline, dest_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    flag || '✈️', route, dates || '', price, badge || '🔥 Hot',
    url || '#', expiry || null, slug, region || 'ie', status === 'draft' ? 'draft' : 'live',
    wasPrice || null, airline || null, destType || null
  ).run();

  return Response.json({ id: result.meta.last_row_id }, { status: 201 });
}
