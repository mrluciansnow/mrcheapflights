// GET /flights-from/:origin — evergreen departure-airport SEO hub.
// Targets "cheap flights from <city>". Region-scoped deals, cross-links to the
// destination hubs, email capture. Mirror of /flights-to/:destination.

import { getOrigin } from '../_lib/origins.js';
import { allDestinations } from '../_lib/destinations.js';
import { originSlugForRoute } from '../_lib/origins.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function flagImg(flagEmoji, px) {
  const chars = Array.from(String(flagEmoji || ''));
  if (chars.length === 2) {
    const a = chars[0].codePointAt(0), b = chars[1].codePointAt(0);
    if (a >= 0x1F1E6 && a <= 0x1F1FF && b >= 0x1F1E6 && b <= 0x1F1FF) {
      const cc = String.fromCharCode(a - 0x1F1E6 + 97, b - 0x1F1E6 + 97);
      return `<img src="https://flagcdn.com/w40/${cc}.png" width="${px}" height="${Math.round(px * 0.75)}" alt="" style="border-radius:3px;vertical-align:middle">`;
    }
  }
  return `<span style="font-size:${px}px">${esc(flagEmoji || '✈️')}</span>`;
}

export async function onRequestGet(context) {
  const isUk = new URL(context.request.url).hostname.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const cur = isUk ? '£' : '€';

  const slug = String(context.params.origin || '').toLowerCase();
  const origin = getOrigin(slug);
  if (!origin) return Response.redirect(`${base}/flights-from`, 302);

  let deals = [];
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT flag, route, dates, price, badge, slug, image_url, was_price FROM deals
       WHERE region=? AND status='live' AND (expiry IS NULL OR date(expiry) >= date('now'))
       ORDER BY created_at DESC LIMIT 60`
    ).bind(region).all();
    deals = (results || []).filter((d) => originSlugForRoute(d.route) === slug);
  } catch { /* DB down — page still renders */ }

  const pageUrl = `${base}/flights-from/${slug}`;
  const title = `Cheap Flights from ${origin.name} — ${origin.name} Flight Deals | Mr Cheap Flights`;
  const desc = `Hand-picked cheap flights from ${origin.name} (${origin.iata}), updated daily. Mistake fares, flash sales and ${cur}-nothing getaways — every deal independently fare-verified.`;

  const dealsHtml = deals.length ? deals.map((d) => {
    const media = d.image_url
      ? `style="background-image:url('${esc(d.image_url)}');background-size:cover;background-position:center"`
      : `style="background:linear-gradient(135deg,#3D2FBE,#7B2FBE 50%,#FF2D78)"`;
    return `<a class="deal" href="${base}/deals/${encodeURIComponent(d.slug)}">
      <div class="deal-media" ${media}></div>
      <div class="deal-body">
        <div class="deal-route">${esc(d.route)}</div>
        <div class="deal-dates">${esc(d.dates || 'Dates flexible')}</div>
        <div class="deal-price">${d.was_price ? `<span class="was">${esc(d.was_price)}</span>` : ''}<small>from</small> ${esc(d.price)}</div>
      </div></a>`;
  }).join('') : '';

  // Cross-link chips to popular destination hubs
  const destChips = allDestinations().slice(0, 14).map((d) =>
    `<a class="chip" href="${base}/flights-to/${d.slug}">${flagImg(d.flag, 18)} ${esc(d.name)}</a>`).join('');

  const graph = [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Mr Cheap Flights', item: base + '/' },
      { '@type': 'ListItem', position: 2, name: 'Flights from', item: base + '/flights-from' },
      { '@type': 'ListItem', position: 3, name: origin.name, item: pageUrl },
    ] },
  ];
  if (deals.length) {
    graph.push({ '@type': 'ItemList', itemListElement: deals.slice(0, 10).map((d, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: { '@type': 'Product', name: d.route,
        offers: { '@type': 'Offer', priceCurrency: isUk ? 'GBP' : 'EUR',
          price: String(d.price).replace(/[^0-9.]/g, '') || '0',
          url: `${base}/deals/${encodeURIComponent(d.slug)}` } },
    })) });
  }

  const html = `<!DOCTYPE html>
<html lang="${isUk ? 'en-GB' : 'en-IE'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(pageUrl)}">
<link rel="alternate" hreflang="en-ie" href="https://mrcheapflights.ie/flights-from/${slug}">
<link rel="alternate" hreflang="en-gb" href="https://mrcheapflights.co.uk/flights-from/${slug}">
<link rel="alternate" hreflang="x-default" href="https://mrcheapflights.ie/flights-from/${slug}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${base}/mascot.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://flagcdn.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Nunito:wght@600;700;800;900&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%23FFD200'/><text y='78' x='50' text-anchor='middle' font-size='68'>✈</text></svg>">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-M49S3C6SZR"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-M49S3C6SZR');</script>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
<style>
:root{--navy:#060B1F;--card:#0A0F2E;--yellow:#FFD200;--pink:#FF2D78;--teal:#00E5CC;--txt:rgba(255,255,255,.85);--dim:rgba(255,255,255,.5)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--navy);color:var(--txt);font-family:'Nunito',system-ui,sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}
.nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:.8rem 1.2rem;background:rgba(6,11,31,.92);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,.06)}
.brand{font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:1.5px;color:var(--yellow)}
.brand span{color:var(--pink)}
.nav-cta{background:rgba(255,210,0,.12);border:1.5px solid rgba(255,210,0,.4);color:var(--yellow);font-weight:800;font-size:.82rem;padding:.5rem 1rem;border-radius:50px}
.hero{background:linear-gradient(135deg,#0A1E5E 0%,#1E5AA8 55%,#00E5CC 100%);padding:2.6rem 1.2rem 2rem}
.hero-inner{max-width:960px;margin:0 auto}
.crumb{color:rgba(255,255,255,.8);font-size:.8rem;font-weight:700;margin-bottom:.4rem}
.crumb a{text-decoration:underline}
h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(2.2rem,6.5vw,4rem);letter-spacing:1px;color:#fff;line-height:1;text-shadow:0 3px 20px rgba(0,0,0,.4)}
.hero-sub{color:#fff;font-weight:800;font-size:1rem;margin-top:.5rem}
.wrap{max-width:960px;margin:0 auto;padding:0 1.2rem}
.section{margin:2.4rem 0}
.section h2{font-family:'Bebas Neue',sans-serif;font-size:1.7rem;letter-spacing:1.5px;color:#fff;margin-bottom:1rem}
.section h2 em{color:var(--yellow);font-style:normal}
.deals{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.9rem}
.deal{background:var(--card);border:1px solid rgba(255,255,255,.09);border-radius:16px;overflow:hidden;transition:transform .15s,border-color .15s}
.deal:hover{transform:translateY(-3px);border-color:rgba(255,210,0,.45)}
.deal-media{height:120px}
.deal-body{padding:.9rem 1rem 1.1rem}
.deal-route{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:.5px;color:#fff}
.deal-dates{color:var(--dim);font-size:.8rem;font-weight:700;margin:.15rem 0 .5rem}
.deal-price{color:var(--yellow);font-weight:900;font-size:1.3rem}
.deal-price .was{color:var(--dim);text-decoration:line-through;font-size:.85rem;font-weight:800;margin-right:.4rem}
.deal-price small{color:var(--dim);font-weight:700;font-size:.72rem}
.empty{background:var(--card);border:1px dashed rgba(255,255,255,.2);border-radius:16px;padding:1.6rem;text-align:center}
.empty b{color:#fff;font-size:1.05rem}
.empty p{color:var(--dim);font-size:.9rem;margin:.4rem 0 0}
.signup{background:linear-gradient(135deg,rgba(255,45,120,.14),rgba(255,210,0,.08));border:1px solid rgba(255,45,120,.35);border-radius:18px;padding:1.5rem;text-align:center}
.signup h3{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:1px;color:#fff}
.signup p{color:var(--dim);font-weight:700;font-size:.9rem;margin:.3rem 0 1rem}
.signup-row{display:flex;gap:.6rem;max-width:460px;margin:0 auto}
.signup-row input{flex:1;min-width:0;background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.15);border-radius:12px;padding:.85rem 1rem;color:#fff;font-family:inherit;font-weight:700}
.signup-row button{background:var(--pink);color:#fff;border:none;border-radius:12px;padding:.85rem 1.3rem;font-family:inherit;font-weight:900;cursor:pointer;white-space:nowrap}
.signup-ok{display:none;color:var(--teal);font-weight:800;padding:.6rem 0}
.chips{display:flex;flex-wrap:wrap;gap:.5rem}
.chip{background:var(--card);border:1px solid rgba(255,255,255,.1);border-radius:50px;padding:.45rem .9rem;font-weight:800;font-size:.85rem;transition:border-color .15s}
.chip:hover{border-color:rgba(255,210,0,.45)}
.foot{border-top:1px solid rgba(255,255,255,.07);margin-top:3rem;padding:1.6rem 1.2rem;text-align:center;color:var(--dim);font-size:.8rem;font-weight:700}
.foot a{color:rgba(255,255,255,.65);text-decoration:underline}
.tag{font-style:italic;color:rgba(255,255,255,.3);margin-top:.5rem}
</style>
</head>
<body>
<nav class="nav"><a class="brand" href="${base}/">MR <span>CHEAP</span> FLIGHTS ✈</a><a class="nav-cta" href="${base}/#deals">Today's deals</a></nav>
<div class="hero"><div class="hero-inner">
  <div class="crumb"><a href="${base}/">Home</a> › <a href="${base}/flights-from">Flights from</a> › ${esc(origin.name)}</div>
  <h1>Cheap Flights from ${esc(origin.name)}</h1>
  <div class="hero-sub">✈ Live deals from ${esc(origin.name)} (${esc(origin.iata)}) · every fare independently verified</div>
</div></div>
<div class="wrap">
  <div class="section">
    <h2>Live <em>${esc(origin.name)}</em> deals</h2>
    ${dealsHtml ? `<div class="deals">${dealsHtml}</div>` : `<div class="empty"><b>No live deals from ${esc(origin.name)} right this minute</b><p>New fares drop daily. Get on the free list below and we'll email you the moment a cheap ${esc(origin.name)} flight appears.</p></div>`}
  </div>

  <div class="section signup">
    <h3>Never miss a ${esc(origin.name)} deal</h3>
    <p>Free deal alerts from ${esc(origin.name)} — unsubscribe anytime.</p>
    <form class="signup-row" id="su-form">
      <input type="email" id="su-email" placeholder="Your email address…" autocomplete="email" required>
      <button type="submit">Get Free Deals ✈</button>
    </form>
    <div class="signup-ok" id="su-ok">🎉 You're in! Watch your inbox for the next drop.</div>
  </div>

  <div class="section">
    <h2>Popular <em>destinations</em></h2>
    <div class="chips">${destChips}</div>
  </div>
</div>
<div class="foot">
  <div>© 2026 <a href="${base}/">Mr Cheap Flights</a> · <a href="${base}/flights-from">All departure airports</a> · <a href="${base}/privacy.html">Privacy</a> · <a href="${base}/terms.html">Terms</a></div>
  <div class="tag">Cheap never looked this good.</div>
</div>
<script>
document.getElementById('su-form').addEventListener('submit',function(e){
  e.preventDefault();
  var email=document.getElementById('su-email').value.trim();
  if(!email||email.indexOf('@')<0)return;
  fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,region:${JSON.stringify(region)},source:'flights-from-${slug}'})})
   .then(function(r){if(r.ok){document.getElementById('su-form').style.display='none';document.getElementById('su-ok').style.display='block';try{if(window.gtag)gtag('event','sign_up',{method:'flights_from_hub'});}catch(_){}}});
});
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=600, stale-while-revalidate=60' },
  });
}
