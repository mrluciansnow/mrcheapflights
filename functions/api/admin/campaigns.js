// Sponsored-marketing campaign admin.
//   GET  /api/admin/campaigns  — list with signups + CPA per campaign
//   POST /api/admin/campaigns  — create a campaign, returns the tracked link
//   PATCH/DELETE via /api/admin/campaigns/:id (see [id].js)

import { requireAdmin } from '../../_lib/auth.js';

const VALID_PLATFORM = new Set(['tiktok', 'instagram', 'other']);
const VALID_TYPE = new Set(['ad', 'influencer']);

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 48);
}

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  // Signups + premium conversions per campaign, joined by source=slug.
  const { results } = await context.env.DB.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM subscribers s WHERE s.source = c.slug) AS signups,
            (SELECT COUNT(*) FROM subscribers s WHERE s.source = c.slug
               AND s.current_period_end IS NOT NULL AND s.current_period_end > unixepoch()) AS premium
     FROM campaigns c ORDER BY c.created_at DESC`
  ).all();

  const rows = (results || []).map((c) => {
    const spend = (c.spend_cents || 0) / 100;
    return {
      ...c,
      spend,
      cpa: c.signups > 0 && spend > 0 ? +(spend / c.signups).toFixed(2) : null,
      conv_rate: c.visits > 0 ? +((c.signups / c.visits) * 100).toFixed(1) : null,
    };
  });
  return Response.json(rows, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const name = String(body.name || '').trim().slice(0, 100);
  if (!name) return Response.json({ error: 'name required' }, { status: 400 });

  const slug = body.slug ? slugify(body.slug) : slugify(name);
  if (!slug) return Response.json({ error: 'could not derive a valid slug' }, { status: 400 });

  const platform = VALID_PLATFORM.has(body.platform) ? body.platform : 'tiktok';
  const type = VALID_TYPE.has(body.type) ? body.type : 'ad';
  const creator = body.creator ? String(body.creator).trim().slice(0, 80) : null;
  const headline = body.headline ? String(body.headline).trim().slice(0, 160) : null;
  const region = ['ie', 'uk'].includes(body.region) ? body.region : 'ie';
  const spendCents = Number.isFinite(+body.spend) && +body.spend >= 0 ? Math.round(+body.spend * 100) : 0;

  try {
    await context.env.DB.prepare(
      `INSERT INTO campaigns (slug, name, platform, type, creator, spend_cents, headline, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(slug, name, platform, type, creator, spendCents, headline, region).run();
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return Response.json({ error: `slug "${slug}" already exists — pick another` }, { status: 409 });
    }
    throw e;
  }

  const base = region === 'uk' ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  return Response.json({ ok: true, slug, link: `${base}/c/${slug}` }, { status: 201 });
}
