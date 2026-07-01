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
    : 'id, flag, route, dates, price, badge, url, expiry, slug, region, was_price, airline';
  let query = `SELECT ${columns} FROM deals`;
  const conditions = [];
  const binds = [];
  if (!session) {
    conditions.push(`status = 'live'`);
    // Auto-retire deals that have been expired for more than 3 days.
    // Grace period accounts for deals that are still bookable after nominal expiry.
    conditions.push(`(expiry IS NULL OR date(expiry) >= date('now', '-3 days'))`);
  }
  if (region) {
    conditions.push('region = ?');
    binds.push(region);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';

  const stmt = context.env.DB.prepare(query);
  const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
  const cacheHeaders = session
    ? { 'Cache-Control': 'private, no-store' }
    : { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=60' };
  return Response.json(results, { headers: cacheHeaders });
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
  if (slug && !/^[a-z0-9-]{1,120}$/.test(slug)) {
    return new Response('slug must be lowercase alphanumeric with hyphens (max 120 chars)', { status: 400 });
  }
  if (!['ie', 'uk'].includes(region || 'ie')) {
    return new Response('region must be ie or uk', { status: 400 });
  }
  if (url && url !== '#' && !/^https?:\/\/.+/.test(url)) {
    return new Response('url must be https://...', { status: 400 });
  }
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return new Response('expiry must be YYYY-MM-DD', { status: 400 });
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
