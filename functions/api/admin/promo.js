// Promo-code admin.
//   GET  /api/admin/promo — list codes with redemptions + linked campaign
//   POST /api/admin/promo — create a code

import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { results } = await context.env.DB.prepare(
    `SELECT p.*, c.name AS campaign_name, c.slug AS campaign_slug
     FROM promo_codes p LEFT JOIN campaigns c ON c.id = p.campaign_id
     ORDER BY p.created_at DESC`
  ).all();
  return Response.json(results || [], { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(code)) {
    return Response.json({ error: 'code must be 2-32 chars, letters/numbers/dashes' }, { status: 400 });
  }
  const trialDays = Number.isFinite(+body.trialDays) && +body.trialDays > 0 ? Math.min(365, Math.round(+body.trialDays)) : 30;
  const maxRedemptions = Number.isFinite(+body.maxRedemptions) && +body.maxRedemptions > 0 ? Math.round(+body.maxRedemptions) : null;
  const campaignId = Number.isFinite(+body.campaignId) && +body.campaignId > 0 ? Math.round(+body.campaignId) : null;

  if (campaignId) {
    const c = await context.env.DB.prepare('SELECT id FROM campaigns WHERE id=?').bind(campaignId).first();
    if (!c) return Response.json({ error: 'campaignId does not exist' }, { status: 400 });
  }

  try {
    await context.env.DB.prepare(
      'INSERT INTO promo_codes (code, campaign_id, trial_days, max_redemptions) VALUES (?, ?, ?, ?)'
    ).bind(code, campaignId, trialDays, maxRedemptions).run();
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return Response.json({ error: `code "${code}" already exists` }, { status: 409 });
    }
    throw e;
  }

  const base = 'https://mrcheapflights.ie';
  return Response.json({ ok: true, code, redeem_link: `${base}/promo/${code}`, trial_days: trialDays }, { status: 201 });
}
