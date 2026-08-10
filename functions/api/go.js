// GET /api/go?deal=<id>&kind=book|fares   or   ?dest=<slug>&kind=fares
// Logs a booking-intent click, then 302s to the real destination.
//
// SECURITY: the redirect target is *never* taken from the query string (that
// would be an open redirect). It is resolved server-side — the deal's stored
// booking URL, or an affiliate fares link generated from the deal/destination.
// Any bad input falls back to the homepage; a click never errors for the user.

import { routeSearchUrl } from '../_lib/affiliate.js';
import { getDestination, destSlugForText } from '../_lib/destinations.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const isUk = url.hostname.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const marker = context.env.TRAVELPAYOUTS_MARKER || '';

  const kind = url.searchParams.get('kind') === 'fares' ? 'fares' : 'book';
  const dealId = parseInt(url.searchParams.get('deal'));
  const destParam = (url.searchParams.get('dest') || '').toLowerCase();

  let target = null, dealIdForLog = null, destSlug = null;

  try {
    if (dealId && dealId > 0) {
      const deal = await context.env.DB.prepare(
        'SELECT id, route, url FROM deals WHERE id=?'
      ).bind(dealId).first();
      if (deal) {
        dealIdForLog = deal.id;
        destSlug = destSlugForText(deal.route);
        if (kind === 'fares') {
          target = routeSearchUrl(deal.route, region, marker);
        } else if (/^https?:\/\//.test(deal.url || '')) {
          target = deal.url;
        }
      }
    } else if (destParam) {
      const dest = getDestination(destParam);
      if (dest) {
        destSlug = dest.slug;
        target = routeSearchUrl(`Dublin → ${dest.name}`, region, marker);
      }
    }
  } catch { /* fall through to homepage */ }

  // Log the click (best-effort; never block the redirect)
  if (target) {
    try {
      await context.env.DB.prepare(
        'INSERT INTO clicks (kind, deal_id, dest_slug, region) VALUES (?, ?, ?, ?)'
      ).bind(kind, dealIdForLog, destSlug, region).run();
    } catch { /* clicks table may not exist yet — ignore */ }
  }

  return Response.redirect(target || `${base}/`, 302);
}
