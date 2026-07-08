// GET /deals/:slug — server-rendered deal landing page.
//
// The sitemap and RSS feed have always linked here, but nothing served the
// route (the SPA only handles #deal/<slug> hashes) — so every crawler hit and
// feed click 404'd. This renders a real, indexable page per deal: unique
// title/description, canonical, OG tags, JSON-LD offer, booking CTA with the
// affiliate fares link, and a link into the interactive SPA view.

import { routeSearchUrl } from '../_lib/affiliate.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const host = url.hostname;
  const isUk = host.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const otherBase = isUk ? 'https://mrcheapflights.ie' : 'https://mrcheapflights.co.uk';

  const slug = context.params.slug;
  if (!slug || !/^[a-z0-9-]{1,120}$/.test(slug)) {
    return Response.redirect(`${base}/`, 302);
  }

  const SELECT = `SELECT flag, route, dates, price, badge, url, expiry, slug, region, was_price, airline
                  FROM deals
                  WHERE slug = ? AND region = ? AND status = 'live'
                    AND (expiry IS NULL OR date(expiry) >= date('now', '-3 days'))`;

  let deal = null;
  try {
    deal = await context.env.DB.prepare(SELECT).bind(slug, region).first();
    if (!deal) {
      // Deal may belong to the other region's site — send the visitor there.
      const other = await context.env.DB.prepare(SELECT).bind(slug, isUk ? 'ie' : 'uk').first();
      if (other) return Response.redirect(`${otherBase}/deals/${encodeURIComponent(slug)}`, 302);
    }
  } catch { /* DB unavailable — fall through to home redirect */ }

  if (!deal) return Response.redirect(`${base}/`, 302);

  const dest = (String(deal.route).split(/→|->/)[1] || deal.route).trim();
  const title = `${deal.route} for ${deal.price} return – Mr Cheap Flights`;
  const desc = `${deal.flag || '✈️'} ${deal.route} from just ${deal.price} return${deal.airline ? ' with ' + deal.airline : ''}. ${deal.dates || ''}${deal.expiry ? ' · Book by ' + deal.expiry : ''}. No commission — book direct.`;
  const pageUrl = `${base}/deals/${encodeURIComponent(deal.slug)}`;
  const bookUrl = /^https?:\/\//.test(deal.url || '') ? deal.url : `${base}/`;
  const searchUrl = routeSearchUrl(deal.route, deal.region, context.env.TRAVELPAYOUTS_MARKER || '');

  const priceNum = String(deal.price).replace(/[^0-9.]/g, '') || '0';
  const currency = String(deal.price).trim().startsWith('£') ? 'GBP' : 'EUR';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: deal.route,
    description: desc,
    offers: {
      '@type': 'Offer',
      price: priceNum,
      priceCurrency: currency,
      availability: 'https://schema.org/InStock',
      url: pageUrl,
      ...(deal.expiry ? { validThrough: deal.expiry } : {}),
    },
  };

  const html = `<!DOCTYPE html>
<html lang="${isUk ? 'en-GB' : 'en-IE'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${base}/mascot.png">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/mascot.png" type="image/png">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
body{background:#060B1F;color:#fff;font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px;box-sizing:border-box;}
a{color:inherit;}
.brand{font-weight:900;font-size:20px;letter-spacing:1px;color:#FFD700;text-decoration:none;margin:8px 0 24px;display:inline-block;}
.brand span{color:#FF2D78;}
.card{background:#0A0F2E;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:36px 30px;max-width:480px;width:100%;text-align:center;box-sizing:border-box;}
.flag{font-size:44px;}
.badge{display:inline-block;background:rgba(255,45,120,0.15);border:1px solid rgba(255,45,120,0.4);color:#FF2D78;font-size:12px;font-weight:800;padding:4px 12px;border-radius:20px;margin:10px 0;}
h1{font-size:24px;margin:6px 0;}
.dates{color:rgba(255,255,255,0.55);font-size:14px;margin-bottom:4px;}
.airline{color:rgba(255,255,255,0.45);font-size:13px;}
.was{color:rgba(255,255,255,0.35);text-decoration:line-through;font-size:15px;margin-right:8px;}
.price{font-size:42px;font-weight:900;color:#FFD700;margin:12px 0 2px;}
.price small{font-size:14px;color:rgba(255,255,255,0.5);font-weight:400;display:block;}
.cta{display:block;background:#FFD700;color:#0A0F2E;font-weight:900;font-size:16px;padding:15px;border-radius:10px;text-decoration:none;margin:20px 0 10px;}
.fares{display:block;color:#FFD700;font-size:14px;font-weight:700;text-decoration:underline;margin-bottom:16px;}
.alt{display:block;color:rgba(255,255,255,0.5);font-size:13px;text-decoration:underline;margin-top:14px;}
.note{color:rgba(255,255,255,0.35);font-size:12px;margin-top:16px;}
.tagline{font-style:italic;color:rgba(255,255,255,0.25);font-size:12px;margin-top:26px;}
</style>
</head>
<body>
<a class="brand" href="${base}/">MR <span>CHEAP</span> FLIGHTS ✈</a>
<div class="card">
  <div class="flag">${esc(deal.flag || '✈️')}</div>
  <div class="badge">${esc(deal.badge || '🔥 Hot')}</div>
  <h1>${esc(deal.route)}</h1>
  <div class="dates">${esc(deal.dates || 'Dates flexible')}</div>
  ${deal.airline ? `<div class="airline">Flying with ${esc(deal.airline)}</div>` : ''}
  <div class="price">${deal.was_price ? `<span class="was">${esc(deal.was_price)}</span>` : ''}${esc(deal.price)}<small>per person · return</small></div>
  ${deal.expiry ? `<div class="dates">⏳ Book by ${esc(deal.expiry)}</div>` : ''}
  <a class="cta" href="${esc(bookUrl)}" rel="noopener noreferrer">Book This Deal ✈</a>
  ${searchUrl ? `<a class="fares" href="${esc(searchUrl)}" rel="noopener noreferrer">🔍 Check live fares</a>` : ''}
  <div class="note">You book directly with the airline. No commission.</div>
  <a class="alt" href="${base}/#deal/${encodeURIComponent(deal.slug)}">See this deal on the full site →</a>
</div>
<div class="tagline">Cheap never looked this good.</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=600, stale-while-revalidate=300',
    },
  });
}
