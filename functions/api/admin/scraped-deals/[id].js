// PATCH  /api/admin/scraped-deals/:id — edit a scraped row before approving.
// DELETE /api/admin/scraped-deals/:id — hard-delete a scraped row.
//
// Approve/reject live in [id]/[action].js (POST /:id/approve|reject — the
// paths the pipeline UI actually calls). PATCH is the missing piece: the
// approve endpoint rejects a row with a bad/missing source URL (422 "edit
// before approving"), and until now there was nothing to edit it with.

import { requireAdmin } from '../../../_lib/auth.js';

// Only these columns are editable — never status/confidence/ai_copy/timestamps.
const EDITABLE = ['route', 'price', 'source_url', 'dates', 'badge', 'region', 'flag'];
const VALID_BADGES = new Set(['🔥 Hot', '⚡ Flash', '✈ Long Haul', '⭐ Featured', '⚠️ Mistake Fare']);

export async function onRequestPatch(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id || id < 1) return new Response('Bad request', { status: 400 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const sets = [], binds = [];
  for (const col of EDITABLE) {
    if (!(col in body)) continue;
    let v = body[col];
    if (v == null) { v = null; }
    else {
      v = String(v).trim().slice(0, 300);
      if (col === 'region' && !['ie', 'uk'].includes(v)) {
        return new Response('region must be ie or uk', { status: 400 });
      }
      if (col === 'badge' && v && !VALID_BADGES.has(v)) {
        return new Response('invalid badge', { status: 400 });
      }
      if (col === 'source_url' && v && !/^https:\/\/[^\s]+\.[^\s]+/.test(v)) {
        return new Response('source_url must be a valid https:// URL', { status: 400 });
      }
    }
    sets.push(`${col}=?`);
    binds.push(v);
  }
  if (!sets.length) return new Response('No editable fields provided', { status: 400 });

  sets.push('updated_at=unixepoch()');
  binds.push(id);
  const res = await context.env.DB.prepare(
    `UPDATE scraped_deals SET ${sets.join(', ')} WHERE id=? AND status='pending'`
  ).bind(...binds).run();

  const changed = res?.meta?.changes ?? res?.changes ?? 0;
  if (!changed) return new Response('Not found or not pending', { status: 404 });

  const row = await context.env.DB.prepare(
    `SELECT id, source_name, source_url, flag, route, dates, price, badge, region, status,
            confidence, dest_type, ai_copy FROM scraped_deals WHERE id=?`
  ).bind(id).first();
  return Response.json(row);
}

export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id || id < 1) return new Response('Bad request', { status: 400 });

  await context.env.DB.prepare('DELETE FROM scraped_deals WHERE id=?').bind(id).run();
  return new Response(null, { status: 204 });
}
