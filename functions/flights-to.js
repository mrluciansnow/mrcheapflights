// GET /flights-to — the destination hub index. Crawlable directory that links
// to every /flights-to/:slug page (spreading internal link equity) and gives
// visitors a browse-by-vibe experience. Shows a live deal count per
// destination so popular ones surface.

import { destinationsByType, destSlugForText } from './_lib/destinations.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function flagImg(flag, px) {
  const c = Array.from(String(flag || ''));
  if (c.length === 2) {
    const a = c[0].codePointAt(0), b = c[1].codePointAt(0);
    if (a >= 0x1F1E6 && a <= 0x1F1FF && b >= 0x1F1E6 && b <= 0x1F1FF) {
      const cc = String.fromCharCode(a - 0x1F1E6 + 97, b - 0x1F1E6 + 97);
      return `<img src="https://flagcdn.com/w40/${cc}.png" width="${px}" height="${Math.round(px * 0.75)}" alt="" style="border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.4)">`;
    }
  }
  return `<span>${esc(flag || '✈️')}</span>`;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const isUk = url.hostname.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const regionName = isUk ? 'UK' : 'Irish';

  // Count live deals per destination slug for a "N live" badge.
  const counts = {};
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT route FROM deals WHERE region=? AND status='live'
         AND (expiry IS NULL OR date(expiry) >= date('now'))`
    ).bind(region).all();
    for (const d of results || []) {
      const s = destSlugForText(d.route);
      if (s) counts[s] = (counts[s] || 0) + 1;
    }
  } catch { /* fine — render without counts */ }

  const groups = destinationsByType();
  const pageUrl = `${base}/flights-to`;
  const title = `Cheap Flights by Destination — ${groups.reduce((n, g) => n + g.items.length, 0)}+ Destinations from ${regionName} Airports | Mr Cheap Flights`;
  const desc = `Browse cheap flight deals to top destinations from ${regionName} airports — city breaks, sun holidays, winter sun and long-haul. Hand-picked fares, updated daily.`;

  const groupsHtml = groups.map((g) => `
    <section class="grp">
      <h2>${esc(g.label)}</h2>
      <div class="grid">
        ${g.items.map((d) => `<a class="card" href="${base}/flights-to/${d.slug}">
          <span class="flag">${flagImg(d.flag, 26)}</span>
          <span class="name">${esc(d.name)}</span>
          ${counts[d.slug] ? `<span class="badge">${counts[d.slug]} live</span>` : ''}
        </a>`).join('')}
      </div>
    </section>`).join('');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Cheap Flights by Destination',
    url: pageUrl,
    isPartOf: { '@type': 'WebSite', name: 'Mr Cheap Flights', url: base + '/' },
  };

  const html = `<!DOCTYPE html>
<html lang="${isUk ? 'en-GB' : 'en-IE'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(pageUrl)}">
<link rel="alternate" hreflang="en-ie" href="https://mrcheapflights.ie/flights-to">
<link rel="alternate" hreflang="en-gb" href="https://mrcheapflights.co.uk/flights-to">
<link rel="alternate" hreflang="x-default" href="https://mrcheapflights.ie/flights-to">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${base}/mascot.png">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Nunito:wght@700;800;900&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%23FFD200'/><text y='78' x='50' text-anchor='middle' font-size='68'>✈</text></svg>">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-M49S3C6SZR"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-M49S3C6SZR');</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
:root{--navy:#060B1F;--card:#0A0F2E;--yellow:#FFD200;--pink:#FF2D78;--teal:#00E5CC;--dim:rgba(255,255,255,.5)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--navy);color:rgba(255,255,255,.85);font-family:'Nunito',system-ui,sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}
.nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:.8rem 1.2rem;background:rgba(6,11,31,.92);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,.06)}
.brand{font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:1.5px;color:var(--yellow)}
.brand span{color:var(--pink)}
.nav-cta{background:rgba(255,210,0,.12);border:1.5px solid rgba(255,210,0,.4);color:var(--yellow);font-weight:800;font-size:.82rem;padding:.5rem 1rem;border-radius:50px}
.head{max-width:1000px;margin:0 auto;padding:2.4rem 1.2rem 1rem}
.head h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(2.2rem,6vw,3.4rem);letter-spacing:1px;color:#fff;line-height:1}
.head h1 em{color:var(--yellow);font-style:normal}
.head p{color:var(--dim);font-weight:700;margin-top:.5rem;max-width:640px}
.wrap{max-width:1000px;margin:0 auto;padding:0 1.2rem 2rem}
.grp{margin:2rem 0}
.grp h2{font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:1.5px;color:var(--teal);margin-bottom:.9rem;border-left:3px solid var(--teal);padding-left:.6rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.7rem}
.card{display:flex;align-items:center;gap:.6rem;background:var(--card);border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:.75rem .9rem;transition:transform .15s,border-color .15s}
.card:hover{transform:translateY(-2px);border-color:rgba(255,210,0,.45)}
.card .name{font-weight:800;color:#fff;flex:1}
.card .badge{background:var(--pink);color:#fff;font-size:.68rem;font-weight:900;padding:2px 7px;border-radius:20px;white-space:nowrap}
.foot{border-top:1px solid rgba(255,255,255,.07);margin-top:2rem;padding:1.6rem 1.2rem;text-align:center;color:var(--dim);font-size:.8rem;font-weight:700}
.foot a{color:rgba(255,255,255,.65);text-decoration:underline}
.tag{font-style:italic;color:rgba(255,255,255,.3);margin-top:.5rem}
</style>
<!-- Travelpayouts attribution/verification (marker 551733) -->
<script data-cfasync="false">
  (function () {
      var script = document.createElement("script");
      script.async = 1;
      script.src = 'https://emrldtp.cc/NTUxNzMz.js?t=551733';
      document.head.appendChild(script);
  })();
</script>
</head>
<body>
<nav class="nav">
  <a class="brand" href="${base}/">MR <span>CHEAP</span> FLIGHTS</a>
  <a class="nav-cta" href="${base}/#deals">Today's deals →</a>
</nav>
<div class="head">
  <h1>CHEAP FLIGHTS BY <em>DESTINATION</em></h1>
  <p>Every great-value getaway from ${regionName} airports, in one place. Pick a destination for live deals, typical fares, and everything you need to book cheap.</p>
</div>
<div class="wrap">
  ${groupsHtml}
</div>
<footer class="foot">
  <a href="${base}/">Mr Cheap Flights</a> · <a href="${base}/privacy.html">Privacy</a> · Hand-picked ${regionName} flight deals since 2024
  <div class="tag">Cheap never looked this good.</div>
</footer>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=1800, stale-while-revalidate=3600' },
  });
}
