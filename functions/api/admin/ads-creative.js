// AI ad-copy for a campaign.
//   GET  /api/admin/ads-creative?campaignId=  — stored variants
//   POST /api/admin/ads-creative { campaignId, dealId? } — generate + store
//        (replaces any existing variants for that campaign)

import { requireAdmin } from '../../_lib/auth.js';
import { generateAdCreative } from '../../_lib/ads-creative.js';

// Decorate variants with their own tracked link (/c/<slug>?v=<n>) and the
// signups attributed to it — this is what turns AI copy into an A/B test.
// A campaign with no /c/ slug gets no link (nothing to attribute to).
async function decorate(env, campaign, variants) {
  const base = campaign.region === 'uk' ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  let counts = {};
  if (campaign.campaign_slug) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT source_variant AS v, COUNT(*) AS n FROM subscribers
         WHERE source=? AND source_variant IS NOT NULL GROUP BY source_variant`
      ).bind(campaign.campaign_slug).all();
      for (const r of results || []) counts[r.v] = r.n;
    } catch { /* pre-migration — no attribution yet */ }
  }
  const rows = variants.map((v) => ({
    ...v,
    link: campaign.campaign_slug ? `${base}/c/${campaign.campaign_slug}?v=${v.variant}` : null,
    signups: counts[v.variant] || 0,
  }));
  // Flag the leader once there's enough signal to be worth acting on.
  const total = rows.reduce((a, r) => a + r.signups, 0);
  if (total >= 5) {
    const best = Math.max(...rows.map((r) => r.signups));
    for (const r of rows) if (r.signups === best && best > 0) r.winner = true;
  }
  return rows;
}

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const cid = parseInt(new URL(context.request.url).searchParams.get('campaignId'));
  if (!cid || cid < 1) return Response.json({ error: 'campaignId required' }, { status: 400 });

  const campaign = await context.env.DB.prepare(
    'SELECT campaign_slug, region FROM ad_campaigns WHERE id=?'
  ).bind(cid).first();
  if (!campaign) return Response.json([], { headers: { 'Cache-Control': 'no-store' } });

  const { results } = await context.env.DB.prepare(
    'SELECT variant, primary_text, headline, description, cta, concept FROM ad_creatives WHERE campaign_id=? ORDER BY variant ASC'
  ).bind(cid).all();
  const rows = await decorate(context.env, campaign, results || []);
  return Response.json(rows, { headers: { 'Cache-Control': 'no-store' } });
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

  const decorated = await decorate(context.env, campaign,
    gen.variants.map((v, n) => ({ ...v, variant: n })));
  return Response.json({ ok: true, campaignId: cid, platform: campaign.platform, variants: decorated }, { status: 201 });
}
