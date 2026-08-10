// POST /api/admin/scraped-deals/:id/approve — validate + copy to deals table
// POST /api/admin/scraped-deals/:id/reject  — mark rejected
//
// These sub-paths MUST live in their own route file: the flat
// ../scraped-deals.js only matches /api/admin/scraped-deals exactly, so the
// original in-file path parsing was unreachable and every manual approve
// 404'd against the static site. (Deals only ever went through via enrich's
// auto-approve.)

import { requireAdmin } from '../../../../_lib/auth.js';
import { destSlugForText, getDestination } from '../../../../_lib/destinations.js';

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 100);
}

// Block SSRF: reject URLs pointing to private/loopback addresses.
function isSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost') return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('[::1]') || h.startsWith('[fe80:')) return false;
  if (!h.includes('.') && !h.includes(':')) return false;
  return true;
}

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  const action = context.params.action;

  if (!id || id < 1 || !['approve', 'reject'].includes(action)) {
    return new Response('Bad request', { status: 400 });
  }

  if (action === 'reject') {
    await context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('rejected', id).run();
    return new Response(null, { status: 204 });
  }

  // approve — validate and copy to `deals`
  const row = await context.env.DB.prepare(
    'SELECT id, source_name, source_url, flag, route, dates, price, badge, region, dest_type, ai_copy FROM scraped_deals WHERE id=?'
  ).bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });

  if (!row.route || !row.price || !row.region) {
    return new Response('Scraped deal missing required fields (route, price, region)', { status: 422 });
  }
  if (!['ie', 'uk'].includes(row.region)) {
    return new Response('Invalid region on scraped deal', { status: 422 });
  }
  const dealUrl = row.source_url || '';
  if (!dealUrl || !isSafeUrl(dealUrl)) {
    return new Response('Scraped deal has missing or invalid source URL — edit before approving', { status: 422 });
  }

  const slug = slugify(row.route) + '-' + String(row.price).replace(/[^0-9]/g, '');

  // Scraped flags are unreliable (feeds tag wrong countries constantly —
  // "Hawaii" arrived flying a Mexican flag). The destinations registry is the
  // source of truth whenever the route maps to a known destination.
  const destHub = destSlugForText(row.route) ? getDestination(destSlugForText(row.route)) : null;
  const flag = destHub?.flag || row.flag || '✈️';

  await context.env.DB.batch([
    context.env.DB.prepare(
      // status must be EXPLICIT: the table default is 'live', which would put
      // plain approves straight on the site and skip the Draft Deals stage.
      // (Existing live deals aren't demoted — the conflict clause leaves status alone.)
      `INSERT INTO deals (flag, route, dates, price, badge, url, slug, region, status, dest_type, ai_copy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
       ON CONFLICT(slug, region) DO UPDATE SET
         price=excluded.price, dates=excluded.dates, dest_type=excluded.dest_type,
         ai_copy=COALESCE(excluded.ai_copy, deals.ai_copy), updated_at=unixepoch()`
    ).bind(flag, row.route, row.dates || '', row.price, row.badge || '🔥 Hot', dealUrl, slug, row.region, row.dest_type || null, row.ai_copy || null),
    context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('approved', id),
  ]);

  // Hand back the draft deal's id so the UI can chain straight into publish
  // ("Approve & publish" one-click path).
  const draft = await context.env.DB.prepare(
    'SELECT id FROM deals WHERE slug=? AND region=?'
  ).bind(slug, row.region).first();

  return Response.json({ ok: true, dealId: draft?.id || null });
}
