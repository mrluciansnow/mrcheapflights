// AI ad-copy for a campaign.
//   GET  /api/admin/ads-creative?campaignId=  — stored variants
//   POST /api/admin/ads-creative { campaignId, dealId? } — generate + store
//        (replaces any existing variants for that campaign)

import { requireAdmin } from '../../_lib/auth.js';
import { generateAdCreative } from '../../_lib/ads-creative.js';

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const cid = parseInt(new URL(context.request.url).searchParams.get('campaignId'));
  if (!cid || cid < 1) return Response.json({ error: 'campaignId required' }, { status: 400 });

  const { results } = await context.env.DB.prepare(
    'SELECT variant, primary_text, headline, description, cta, concept FROM ad_creatives WHERE campaign_id=? ORDER BY variant ASC'
  ).bind(cid).all();
  return Response.json(results || [], { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const cid = parseInt(body.campaignId);
  if (!cid || cid < 1) return Response.json({ error: 'campaignId required' }, { status: 400 });

  const campaign = await context.env.DB.prepare('SELECT * FROM ad_campaigns WHERE id=?').bind(cid).first();
  if (!campaign) return Response.json({ error: 'campaign not found' }, { status: 404 });

  let deal = null;
  if (body.dealId) {
    deal = await context.env.DB.prepare('SELECT route, price, dates FROM deals WHERE id=?').bind(parseInt(body.dealId)).first();
  }

  const gen = await generateAdCreative(context.env, campaign, { deal });
  if (!gen.ok) return Response.json({ error: gen.error, raw: gen.raw }, { status: gen.status || 502 });

  // Replace previous variants for this campaign so the set stays coherent.
  await context.env.DB.prepare('DELETE FROM ad_creatives WHERE campaign_id=?').bind(cid).run();
  let i = 0;
  for (const v of gen.variants) {
    await context.env.DB.prepare(
      `INSERT INTO ad_creatives (campaign_id, platform, variant, primary_text, headline, description, cta, concept)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(cid, campaign.platform, i++, v.primary_text, v.headline, v.description, v.cta, v.concept).run();
  }
  await context.env.DB.prepare('UPDATE ad_campaigns SET updated_at=unixepoch() WHERE id=?').bind(cid).run();

  return Response.json({ ok: true, campaignId: cid, platform: campaign.platform, variants: gen.variants }, { status: 201 });
}
