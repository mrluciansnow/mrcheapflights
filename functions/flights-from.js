// GET /flights-from — index of departure-airport hubs for this region.

import { originsForRegion } from './_lib/origins.js';
import { originSlugForRoute } from './_lib/origins.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function onRequestGet(context) {
  const isUk = new URL(context.request.url).hostname.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const regionName = isUk ? 'the UK' : 'Ireland';

  const origins = originsForRegion(region);

  // Live-deal count per origin (best-effort)
  const counts = {};
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT route FROM deals WHERE region=? AND status='live'
       AND (expiry IS NULL OR date(expiry) >= date('now'))`
    ).bind(region).all();
    for (const d of results || []) {
      const s = originSlugForRoute(d.route);
      if (s) counts[s] = (counts[s] || 0) + 1;
    }
  } catch { /* ignore */ }

  const title = `Cheap Flights from ${regionName} — by Airport | Mr Cheap Flights`;
  const desc = `Browse cheap flight deals by departure airport across ${regionName}. Pick your airport and see live fares — every deal independently verified.`;

  const cards = origins.map((o) => {
    const n = counts[o.slug] || 0;
    return `<a class="card" href="${base}/flights-from/${o.slug}">
      <div class="c-name">${esc(o.name)} <span class="iata">${esc(o.iata)}</span></div>
      <div class="c-sub">${n ? `${n} live deal${n > 1 ? 's' : ''}` : 'Deals drop daily'}</div>
    </a>`;
  }).join('');

  const graph = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Mr Cheap Flights', item: base + '/' },
    { '@type': 'ListItem', position: 2, name: 'Flights from', item: base + '/flights-from' },
  ] };

  const html = `<!DOCTYPE html>
<html lang="${isUk ? 'en-GB' : 'en-IE'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${base}/flights-from">
<link rel="alternate" hreflang="en-ie" href="https://mrcheapflights.ie/flights-from">
<link rel="alternate" hreflang="en-gb" href="https://mrcheapflights.co.uk/flights-from">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Nunito:wght@600;700;800;900&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%23FFD200'/><text y='78' x='50' text-anchor='middle' font-size='68'>✈</text></svg>">
<script type="application/ld+json">${JSON.stringify(graph)}</script>
<style>
:root{--navy:#060B1F;--card:#0A0F2E;--yellow:#FFD200;--pink:#FF2D78;--teal:#00E5CC;--dim:rgba(255,255,255,.5)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--navy);color:rgba(255,255,255,.85);font-family:'Nunito',system-ui,sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}
.nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:.8rem 1.2rem;background:rgba(6,11,31,.92);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,.06)}
.brand{font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:1.5px;color:var(--yellow)}
.brand span{color:var(--pink)}
.wrap{max-width:960px;margin:0 auto;padding:2rem 1.2rem}
h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(2rem,6vw,3.4rem);letter-spacing:1px;color:#fff;line-height:1}
.sub{color:var(--dim);font-weight:700;margin:.5rem 0 1.6rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.8rem}
.card{background:var(--card);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:1.1rem 1.2rem;transition:transform .15s,border-color .15s}
.card:hover{transform:translateY(-3px);border-color:rgba(255,210,0,.45)}
.c-name{font-family:'Bebas Neue',sans-serif;font-size:1.35rem;letter-spacing:.5px;color:#fff}
.iata{color:var(--teal);font-size:.85rem}
.c-sub{color:var(--dim);font-size:.82rem;font-weight:700;margin-top:.2rem}
.foot{border-top:1px solid rgba(255,255,255,.07);margin-top:2.5rem;padding:1.6rem 1.2rem;text-align:center;color:var(--dim);font-size:.8rem;font-weight:700}
.foot a{color:rgba(255,255,255,.65);text-decoration:underline}
</style>
</head>
<body>
<nav class="nav"><a class="brand" href="${base}/">MR <span>CHEAP</span> FLIGHTS ✈</a><a class="brand" style="font-size:.9rem" href="${base}/flights-to">Flights to →</a></nav>
<div class="wrap">
  <h1>Cheap Flights from ${esc(regionName)}</h1>
  <div class="sub">Pick your departure airport — live deals, every fare verified.</div>
  <div class="grid">${cards}</div>
</div>
<div class="foot"><a href="${base}/flights-to">Browse by destination →</a> · <a href="${base}/privacy.html">Privacy</a> · <a href="${base}/terms.html">Terms</a></div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=600, stale-while-revalidate=60' },
  });
}
