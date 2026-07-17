// GET /flights-to/:destination — EVERGREEN destination hub page.
//
// The programmatic-SEO growth engine. Unlike /deals/:slug (which expire and
// churn out of the index), these pages are permanent, accumulate ranking for
// high-intent queries like "cheap flights to Barcelona from Dublin", and pull
// organic traffic that converts to subscribers. Each page carries:
//   • AI-written evergreen guide (intro / best time / airlines / highlights)
//   • live deals to this destination (or an alert-signup empty state)
//   • FAQPage + BreadcrumbList JSON-LD for rich results
//   • hreflang linking the .ie and .co.uk versions
//   • destination-specific email capture + cross-links to related hubs

import { getDestination, destinationsByType, destSlugForText } from '../_lib/destinations.js';
import { routeSearchUrl } from '../_lib/affiliate.js';

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
      return `<img src="https://flagcdn.com/w${px >= 40 ? 80 : 40}/${cc}.png" width="${px}" height="${Math.round(px * 0.75)}" alt="" style="border-radius:4px;vertical-align:middle;box-shadow:0 2px 8px rgba(0,0,0,.4)">`;
    }
  }
  return `<span style="font-size:${px}px">${esc(flagEmoji || '✈️')}</span>`;
}

const TYPE_GRADIENTS = {
  sun:       'linear-gradient(135deg,#FF6B2B 0%,#FF2D78 55%,#7B2FBE 100%)',
  wintersun: 'linear-gradient(135deg,#00B4A0 0%,#FFB300 60%,#FF6B2B 100%)',
  city:      'linear-gradient(135deg,#3D2FBE 0%,#7B2FBE 50%,#FF2D78 100%)',
  longhaul:  'linear-gradient(135deg,#0A1E5E 0%,#1E5AA8 55%,#00E5CC 100%)',
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const isUk = url.hostname.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const altBase = isUk ? 'https://mrcheapflights.ie' : 'https://mrcheapflights.co.uk';
  const regionName = isUk ? 'the UK' : 'Ireland';
  const cur = isUk ? '£' : '€';

  const slug = context.params.destination;
  const dest = getDestination(slug);
  if (!dest) return Response.redirect(`${base}/flights-to`, 302);

  // Cached AI content (may be absent until the generator has run)
  let content = null, liveDeals = [];
  try {
    content = await context.env.DB.prepare(
      'SELECT intro, guide_json, image_url FROM destination_content WHERE slug=?'
    ).bind(slug).first();

    const { results } = await context.env.DB.prepare(
      `SELECT flag, route, dates, price, badge, slug, image_url, was_price, airline
       FROM deals WHERE region=? AND status='live'
         AND (expiry IS NULL OR date(expiry) >= date('now'))
       ORDER BY created_at DESC LIMIT 40`
    ).bind(region).all();
    liveDeals = (results || []).filter((d) => destSlugForText(d.route) === slug);
  } catch { /* DB unavailable — page still renders from static registry */ }

  let guide = {};
  try { guide = content?.guide_json ? JSON.parse(content.guide_json) : {}; } catch { guide = {}; }

  const pageUrl = `${base}/flights-to/${slug}`;
  const priceFrom = guide.price_from || `cheap ${cur} return fares`;
  const title = `Cheap Flights to ${dest.name} from ${regionName} — ${dest.name} Deals | Mr Cheap Flights`;
  const desc = `Find cheap flights to ${dest.name}, ${dest.country} from ${regionName}. ${guide.intro ? String(guide.intro).slice(0, 110) : `Hand-picked ${dest.name} flight deals, updated daily.`} ${priceFrom}.`;
  const heroImg = content?.image_url
    ? (content.image_url.startsWith('/') ? base + content.image_url : content.image_url)
    : null;
  const heroImgRel = content?.image_url || null;
  const gradient = TYPE_GRADIENTS[dest.type] || TYPE_GRADIENTS.city;

  // ── Deal cards ──
  const dealsHtml = liveDeals.length ? liveDeals.map((d) => {
    const img = d.image_url || null;
    const media = img
      ? `style="background-image:url('${esc(img)}');background-size:cover;background-position:center"`
      : `style="background:${gradient}"`;
    return `<a class="deal" href="${base}/deals/${encodeURIComponent(d.slug)}">
      <div class="deal-media" ${media}></div>
      <div class="deal-body">
        <div class="deal-route">${esc(d.route)}</div>
        <div class="deal-dates">${esc(d.dates || 'Dates flexible')}</div>
        <div class="deal-price">${d.was_price ? `<span class="was">${esc(d.was_price)}</span>` : ''}<small>from</small> ${esc(d.price)}</div>
      </div></a>`;
  }).join('') : '';

  const searchUrl = routeSearchUrl(`Dublin → ${dest.name}`, region, context.env.TRAVELPAYOUTS_MARKER || '');

  // ── FAQ (+ schema) ──
  const faqs = Array.isArray(guide.faq) ? guide.faq : [];
  const faqHtml = faqs.map((f) => `
    <details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');

  const highlights = Array.isArray(guide.highlights) ? guide.highlights : [];
  const highlightsHtml = highlights.map((h) => `<li>${esc(h)}</li>`).join('');

  // ── Related hubs (same type, excluding self) ──
  const related = destinationsByType().flatMap((g) => g.items)
    .filter((d) => d.type === dest.type && d.slug !== slug).slice(0, 6);
  const relatedHtml = related.map((d) => `<a class="chip" href="${base}/flights-to/${d.slug}">${flagImg(d.flag, 18)} ${esc(d.name)}</a>`).join('');

  // ── JSON-LD ──
  const graph = [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Mr Cheap Flights', item: base + '/' },
      { '@type': 'ListItem', position: 2, name: 'Flights to', item: base + '/flights-to' },
      { '@type': 'ListItem', position: 3, name: dest.name, item: pageUrl },
    ] },
  ];
  if (faqs.length) {
    graph.push({ '@type': 'FAQPage', mainEntity: faqs.map((f) => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })) });
  }
  if (liveDeals.length) {
    graph.push({ '@type': 'ItemList', itemListElement: liveDeals.slice(0, 10).map((d, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: { '@type': 'Product', name: d.route,
        offers: { '@type': 'Offer', priceCurrency: cur === '£' ? 'GBP' : 'EUR',
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
<link rel="alternate" hreflang="en-ie" href="https://mrcheapflights.ie/flights-to/${slug}">
<link rel="alternate" hreflang="en-gb" href="https://mrcheapflights.co.uk/flights-to/${slug}">
<link rel="alternate" hreflang="x-default" href="https://mrcheapflights.ie/flights-to/${slug}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(heroImg || base + '/mascot.png')}">
<meta name="twitter:card" content="${heroImg ? 'summary_large_image' : 'summary'}">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
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
.hero{position:relative;height:340px;background:${gradient};overflow:hidden}
.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,11,31,.25) 0%,rgba(6,11,31,.5) 55%,var(--navy) 100%)}
.hero-inner{position:absolute;bottom:0;left:0;right:0;z-index:2;max-width:960px;margin:0 auto;padding:0 1.2rem 1.5rem}
.crumb{color:rgba(255,255,255,.7);font-size:.8rem;font-weight:700;margin-bottom:.4rem}
.crumb a{text-decoration:underline}
h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(2.2rem,6.5vw,4rem);letter-spacing:1px;color:#fff;line-height:1;text-shadow:0 3px 20px rgba(0,0,0,.5)}
.hero-sub{color:#fff;font-weight:800;font-size:1rem;margin-top:.4rem;text-shadow:0 2px 12px rgba(0,0,0,.6)}
.wrap{max-width:960px;margin:0 auto;padding:0 1.2rem}
.intro{font-size:1.05rem;line-height:1.7;color:var(--txt);margin:1.6rem 0}
.section{margin:2.4rem 0}
.section h2{font-family:'Bebas Neue',sans-serif;font-size:1.7rem;letter-spacing:1.5px;color:#fff;margin-bottom:1rem}
.section h2 em{color:var(--yellow);font-style:normal}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.8rem}
.fact{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:1rem 1.1rem}
.fact b{display:block;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--teal);font-size:.95rem;margin-bottom:.25rem}
.fact span{font-size:.92rem;color:var(--txt);font-weight:600}
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
ul.hl{list-style:none;display:grid;gap:.5rem}
ul.hl li{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:.7rem .95rem;font-weight:700;font-size:.92rem}
ul.hl li::before{content:'★ ';color:var(--yellow)}
.faq{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:.1rem .3rem;margin-bottom:.5rem}
.faq summary{cursor:pointer;font-weight:800;color:#fff;padding:.85rem 1rem;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::before{content:'＋ ';color:var(--yellow)}
.faq[open] summary::before{content:'－ '}
.faq p{padding:0 1rem 1rem;color:var(--txt);line-height:1.6}
.signup{background:linear-gradient(135deg,rgba(255,45,120,.14),rgba(255,210,0,.08));border:1px solid rgba(255,45,120,.35);border-radius:18px;padding:1.5rem;text-align:center}
.signup h3{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:1px;color:#fff}
.signup p{color:var(--dim);font-weight:700;font-size:.9rem;margin:.3rem 0 1rem}
.signup-row{display:flex;gap:.6rem;max-width:460px;margin:0 auto}
.signup-row input{flex:1;min-width:0;background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.15);border-radius:12px;padding:.85rem 1rem;color:#fff;font-family:inherit;font-weight:700}
.signup-row button{background:var(--pink);color:#fff;border:none;border-radius:12px;padding:.85rem 1.3rem;font-family:inherit;font-weight:900;cursor:pointer;white-space:nowrap}
.signup-ok{display:none;color:var(--teal);font-weight:800;padding:.6rem 0}
.cta-fares{display:inline-block;margin-top:.4rem;color:var(--yellow);font-weight:800;text-decoration:underline;font-size:.95rem}
.chips{display:flex;flex-wrap:wrap;gap:.5rem}
.chip{background:var(--card);border:1px solid rgba(255,255,255,.1);border-radius:50px;padding:.45rem .9rem;font-weight:800;font-size:.85rem;transition:border-color .15s}
.chip:hover{border-color:rgba(255,210,0,.45)}
.foot{border-top:1px solid rgba(255,255,255,.07);margin-top:3rem;padding:1.6rem 1.2rem;text-align:center;color:var(--dim);font-size:.8rem;font-weight:700}
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
  <a class="nav-cta" href="${base}/flights-to">All destinations →</a>
</nav>

<div class="hero">
  ${heroImgRel ? `<img class="hero-img" src="${esc(heroImgRel)}" alt="${esc(dest.name)}" fetchpriority="high">` : ''}
  <div class="hero-inner">
    <div class="crumb"><a href="${base}/">Home</a> › <a href="${base}/flights-to">Flights to</a> › ${esc(dest.name)}</div>
    <h1>${flagImg(dest.flag, 40)} Cheap Flights to ${esc(dest.name)}</h1>
    <div class="hero-sub">From ${regionName} · ${esc(priceFrom)}</div>
  </div>
</div>

<main class="wrap">
  ${content?.intro ? `<p class="intro">${esc(content.intro)}</p>` : `<p class="intro">${esc(dest.name)}, ${esc(dest.country)} — home to ${esc(dest.landmark)} — is one of the best-value getaways from ${regionName}. We hunt down cheap flights to ${esc(dest.name)} every day so you don't have to.</p>`}

  <section class="section">
    <h2>LIVE ${esc(dest.name.toUpperCase())} <em>DEALS</em></h2>
    ${liveDeals.length
      ? `<div class="deals">${dealsHtml}</div>`
      : `<div class="empty"><b>✈ No live deals to ${esc(dest.name)} right this minute</b><p>New fares drop daily. Get on the list below and we'll email you the moment a cheap ${esc(dest.name)} flight appears.</p>${searchUrl ? `<a class="cta-fares" href="/api/go?dest=${slug}&kind=fares" rel="noopener noreferrer">🔍 Check live fares to ${esc(dest.name)} now →</a>` : ''}</div>`}
  </section>

  <section class="section signup">
    <h3>🔔 Get ${esc(dest.name)} price alerts</h3>
    <p>We'll email you the moment a cheap ${esc(dest.name)} flight drops — free, unsubscribe anytime.</p>
    <form class="signup-row" id="su-form">
      <input type="email" id="su-email" placeholder="Your email address…" autocomplete="email" required>
      <button type="submit">Set ${esc(dest.name)} Alert 🔔</button>
    </form>
    <div class="signup-ok" id="su-ok">🎉 Alert set! We'll email you the next ${esc(dest.name)} deal.</div>
  </section>

  ${(guide.best_time || guide.airlines || guide.price_from) ? `<section class="section">
    <h2>FLYING TO <em>${esc(dest.name.toUpperCase())}</em></h2>
    <div class="facts">
      ${guide.price_from ? `<div class="fact"><b>Typical fares</b><span>${esc(guide.price_from)}</span></div>` : ''}
      ${guide.best_time ? `<div class="fact"><b>Best time to go</b><span>${esc(guide.best_time)}</span></div>` : ''}
      ${guide.airlines ? `<div class="fact"><b>Who flies there</b><span>${esc(guide.airlines)}</span></div>` : ''}
    </div>
  </section>` : ''}

  ${highlights.length ? `<section class="section"><h2>TOP THINGS TO DO IN <em>${esc(dest.name.toUpperCase())}</em></h2><ul class="hl">${highlightsHtml}</ul></section>` : ''}

  ${faqs.length ? `<section class="section"><h2>${esc(dest.name.toUpperCase())} FLIGHT <em>FAQ</em></h2>${faqHtml}</section>` : ''}

  ${related.length ? `<section class="section"><h2>MORE <em>${dest.type === 'longhaul' ? 'LONG-HAUL' : dest.type === 'wintersun' ? 'WINTER SUN' : dest.type === 'sun' ? 'SUN' : 'CITY BREAK'}</em> DESTINATIONS</h2><div class="chips">${relatedHtml}</div></section>` : ''}
</main>

<footer class="foot">
  <a href="${base}/">Mr Cheap Flights</a> · <a href="${base}/flights-to">All destinations</a> · <a href="${base}/privacy.html">Privacy</a>
  <div class="tag">Cheap never looked this good.</div>
</footer>

<script>
(function(){
  var f=document.getElementById('su-form');if(!f)return;
  var reset='Set ${esc(dest.name)} Alert 🔔';
  f.addEventListener('submit',function(e){e.preventDefault();
    var email=document.getElementById('su-email').value.trim();if(!email)return;
    var b=f.querySelector('button');b.disabled=true;b.textContent='Setting…';
    fetch('/api/watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,region:'${region}',dest:'${slug}'})})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(data){
        if(data&&data.ok){
          f.style.display='none';
          var ok=document.getElementById('su-ok');
          if(data.already){ok.innerHTML='🎉 Alert set — and there\\'s one live right now! <a href="/deals/'+encodeURIComponent(data.already.slug)+'" style="color:#FFD700;text-decoration:underline;font-weight:900">'+data.already.route+' from '+data.already.price+' →</a>';}
          ok.style.display='block';
          gtag('event','sign_up',{method:'destination_alert',destination:'${slug}'});
        } else {b.disabled=false;b.textContent=reset;}
      })
      .catch(function(){b.disabled=false;b.textContent=reset;});
  });
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=1800, stale-while-revalidate=3600',
    },
  });
}
