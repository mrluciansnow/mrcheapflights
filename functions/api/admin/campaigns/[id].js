// PATCH  /api/admin/campaigns/:id — update spend / active / headline / creator
// DELETE /api/admin/campaigns/:id — remove a campaign (signups keep their tag)

import { requireAdmin } from '../../../_lib/auth.js';

export async function onRequestPatch(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id || id < 1) return new Response('Bad request', { status: 400 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const sets = [], binds = [];
  if ('spend' in body && Number.isFinite(+body.spend) && +body.spend >= 0) {
    sets.push('spend_cents=?'); binds.push(Math.round(+body.spend * 100));
  }
  if ('active' in body) { sets.push('active=?'); binds.push(body.active ? 1 : 0); }
  if ('headline' in body) { sets.push('headline=?'); binds.push(body.headline ? String(body.headline).trim().slice(0, 160) : null); }
  if ('creator' in body) { sets.push('creator=?'); binds.push(body.creator ? String(body.creator).trim().slice(0, 80) : null); }
  if (!sets.length) return new Response('No editable fields', { status: 400 });

  binds.push(id);
  const res = await context.env.DB.prepare(
    `UPDATE campaigns SET ${sets.join(', ')} WHERE id=?`
  ).bind(...binds).run();
  const changed = res?.meta?.changes ?? res?.changes ?? 0;
  if (!changed) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 204 });
}

export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id || id < 1) return new Response('Bad request', { status: 400 });

  await context.env.DB.prepare('DELETE FROM campaigns WHERE id=?').bind(id).run();
  return new Response(null, { status: 204 });
}
