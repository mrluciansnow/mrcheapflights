import { requireAdmin } from '../../../_lib/auth.js';

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

// PATCH /api/admin/scraped-deals/:id  { action: "approve" | "reject" }
export async function onRequestPatch(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id) return new Response('Bad request', { status: 400 });

  const { action } = await context.request.json();
  if (!['approve', 'reject'].includes(action)) return new Response('Bad action', { status: 400 });

  if (action === 'reject') {
    await context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('rejected', id).run();
    return new Response(null, { status: 204 });
  }

  const row = await context.env.DB.prepare('SELECT * FROM scraped_deals WHERE id=?').bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });

  const slug = slugify(row.route) + '-' + row.price.replace(/[^0-9]/g, '');
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO deals (flag, route, dates, price, badge, url, slug, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, region) DO UPDATE SET
         price=excluded.price, dates=excluded.dates, updated_at=unixepoch()`
    ).bind(row.flag, row.route, row.dates, row.price, row.badge, row.source_url || '#', slug, row.region),
    context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('approved', id),
  ]);

  return new Response(null, { status: 204 });
}

// DELETE /api/admin/scraped-deals/:id
export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id) return new Response('Bad request', { status: 400 });

  await context.env.DB.prepare('DELETE FROM scraped_deals WHERE id=?').bind(id).run();
  return new Response(null, { status: 204 });
}
