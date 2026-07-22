// PATCH  /api/admin/ads/:id — control one campaign
//   { op:'status', target:'paused'|'active'|'archived' }  status change
//        (activate = the one action that can start real spend; human-gated,
//         and still a no-op unless ADS_LIVE=1 + platform configured)
//   { op:'launch' }                                       (re)launch a draft PAUSED
//   { op:'target', targetCpa:<number|null> }              set/clear the guardrail threshold
// DELETE /api/admin/ads/:id — remove the local mirror (does not touch the
//        platform; a launched campaign is PAUSED so it never spends, but tidy up
//        in Ads Manager too if you launched it).

import { requireAdmin } from '../../../_lib/auth.js';
import { setCampaignStatus, launchCampaign } from '../../../_lib/ads-engine.js';

export async function onRequestPatch(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id || id < 1) return new Response('Bad request', { status: 400 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  if (body.op === 'status') {
    const r = await setCampaignStatus(context.env, id, body.target);
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    return Response.json(r);
  }

  if (body.op === 'launch') {
    const r = await launchCampaign(context.env, id);
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    return Response.json(r);
  }

  if (body.op === 'target') {
    const cpa = parseFloat(body.targetCpa);
    const cents = Number.isFinite(cpa) && cpa > 0 ? Math.round(cpa * 100) : null;
    const res = await context.env.DB.prepare(
      'UPDATE ad_campaigns SET target_cpa_cents=?, updated_at=unixepoch() WHERE id=?'
    ).bind(cents, id).run();
    const changed = res?.meta?.changes ?? 0;
    if (!changed) return new Response('Not found', { status: 404 });
    return Response.json({ ok: true, target_cpa: cents != null ? cents / 100 : null });
  }

  return new Response('Unknown op', { status: 400 });
}

export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id || id < 1) return new Response('Bad request', { status: 400 });

  await context.env.DB.prepare('DELETE FROM ad_campaigns WHERE id=?').bind(id).run();
  await context.env.DB.prepare('DELETE FROM ad_actions WHERE campaign_id=?').bind(id).run();
  return new Response(null, { status: 204 });
}
