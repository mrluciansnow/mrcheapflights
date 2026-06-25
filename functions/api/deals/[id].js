import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestPut(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { id } = context.params;
  const body = await context.request.json();
  const { flag, route, dates, price, badge, url, expiry, slug, region } = body;
  if (!route || !price || !slug) {
    return new Response('route, price and slug are required', { status: 400 });
  }

  await context.env.DB.prepare(
    `UPDATE deals SET flag=?, route=?, dates=?, price=?, badge=?, url=?, expiry=?, slug=?, region=?, updated_at=unixepoch()
     WHERE id=?`
  ).bind(
    flag || '✈️', route, dates || '', price, badge || '🔥 Hot',
    url || '#', expiry || null, slug, region || 'ie', id
  ).run();

  return new Response(null, { status: 204 });
}

export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  await context.env.DB.prepare('DELETE FROM deals WHERE id = ?').bind(context.params.id).run();
  return new Response(null, { status: 204 });
}
