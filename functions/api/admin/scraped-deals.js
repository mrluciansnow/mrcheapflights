import { requireAdmin } from '../../_lib/auth.js';

// Admin CRUD for scraped deals.
// GET  /api/admin/scraped-deals?status=pending  — list
// POST /api/admin/scraped-deals/:id/approve     — copy to deals table
// POST /api/admin/scraped-deals/:id/reject      — mark rejected
// DELETE /api/admin/scraped-deals/:id           — hard-delete

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const url = new URL(context.request.url);
  const status = url.searchParams.get('status') || 'pending';
  const region = url.searchParams.get('region');

  let sql = 'SELECT * FROM scraped_deals WHERE status = ?';
  const params = [status];
  if (region) { sql += ' AND region = ?'; params.push(region); }
  sql += ' ORDER BY created_at DESC LIMIT 100';

  const { results } = await context.env.DB.prepare(sql).bind(...params).all();
  return Response.json(results);
}

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const url = new URL(context.request.url);
  const parts = url.pathname.split('/');
  const id = parseInt(parts[parts.length - 2]);
  const action = parts[parts.length - 1]; // 'approve' or 'reject'

  if (!id || !['approve', 'reject'].includes(action)) {
    return new Response('Bad request', { status: 400 });
  }

  if (action === 'reject') {
    await context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('rejected', id).run();
    return new Response(null, { status: 204 });
  }

  // approve — fetch the scraped deal and copy it to `deals`
  const row = await context.env.DB.prepare(
    'SELECT * FROM scraped_deals WHERE id=?'
  ).bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });

  const slug = slugify(row.route) + '-' + row.price.replace(/[^0-9]/g, '');

  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO deals (flag, route, dates, price, badge, url, slug, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, region) DO UPDATE SET
         price=excluded.price, dates=excluded.dates, updated_at=unixepoch()`
    ).bind(row.flag, row.route, row.dates, row.price, row.badge, row.source_url, slug, row.region),
    context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('approved', id),
  ]);

  return new Response(null, { status: 204 });
}

export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const url = new URL(context.request.url);
  const id = parseInt(url.pathname.split('/').pop());
  if (!id) return new Response('Bad request', { status: 400 });

  await context.env.DB.prepare('DELETE FROM scraped_deals WHERE id=?').bind(id).run();
  return new Response(null, { status: 204 });
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}
