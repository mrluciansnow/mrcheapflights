// GET /deals/:slug — conversion-grade deal landing page (server-rendered).
//
// This is where RSS clicks, social shares, newsletter CTAs and Google land,
// so it carries the full brand and a complete conversion path:
//   hero (AI image or destination-typed gradient) → price panel with savings
//   + expiry countdown → book/fares CTAs → email capture → related deals →
//   booking tips → trust footer. Sticky book bar on mobile.
//
// Flags render as SVG images (flagcdn) decoded from the stored emoji —
// Windows browsers show "PT"/"US" text for flag emojis, which looks broken.

import { routeSearchUrl } from '../_lib/affiliate.js';
import { destSlugForText, getDestination } from '../_lib/destinations.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Flag emoji → ISO alpha-2 (regional indicator pair) → flagcdn image URL.
function flagInfo(flagEmoji) {
  const chars = Array.from(String(flagEmoji || ''));
  if (chars.length === 2) {
    const a = chars[0].codePointAt(0), b = chars[1].codePointAt(0);
    if (a >= 0x1F1E6 && a <= 0x1F1FF && b >= 0x1F1E6 && b <= 0x1F1FF) {
      const cc = String.fromCharCode(a - 0x1F1E6 + 97, b - 0x1F1E6 + 97);
      return { cc, img: `https://flagcdn.com/w160/${cc}.png` };
    }
  }
  return null;
}

// Destination-type → hero gradient when no AI image exists yet.
const TYPE_GRADIENTS = {
  sun:       'linear-gradient(135deg,#FF6B2B 0%,#FF2D78 55%,#7B2FBE 100%)',
  wintersun: 'linear-gradient(135deg,#00B4A0 0%,#FFB300 60%,#FF6B2B 100%)',
  city:      'linear-gradient(135deg,#3D2FBE 0%,#7B2FBE 50%,#FF2D78 100%)',
  longhaul:  'linear-gradient(135deg,#0A1E5E 0%,#1E5AA8 55%,#00E5CC 100%)',
};

function parsePrice(s) { const n = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; }

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const host = url.hostname;
  const isUk = host.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const otherBase = isUk ? 'https://mrcheapflights.ie' : 'https://mrcheapflights.co.uk';
  const regionName = isUk ? 'UK' : 'Irish';

  const slug = context.params.slug;
  if (!slug || !/^[a-z0-9-]{1,120}$/.test(slug)) {
    return Response.redirect(`${base}/`, 302);
  }

  const SELECT = `SELECT id, flag, route, dates, price, badge, url, expiry, slug, region, was_price, airline, image_url, dest_type
                  FROM deals
                  WHERE slug = ? AND region = ? AND status = 'live'
                    AND (expiry IS NULL OR date(expiry) >= date('now', '-3 days'))`;

  let deal = null;
  let related = [];
  try {
    deal = await context.env.DB.prepare(SELECT).bind(slug, region).first();
    if (!deal) {
      const other = await context.env.DB.prepare(SELECT).bind(slug, isUk ? 'ie' : 'uk').first();
      if (other) return Response.redirect(`${otherBase}/deals/${encodeURIComponent(slug)}`, 302);
    } else {
      const rel = await context.env.DB.prepare(
        `SELECT flag, route, dates, price, badge, slug, image_url, dest_type FROM deals
         WHERE region = ? AND status = 'live' AND slug != ?
           AND (expiry IS NULL OR date(expiry) >= date('now'))
         ORDER BY created_at DESC LIMIT 3`
      ).bind(region, slug).all();
      related = rel.results || [];
    }
  } catch { /* DB unavailable — fall through to home redirect */ }

  if (!deal) return Response.redirect(`${base}/`, 302);

  const dest = (String(deal.route).split(/→|->/)[1] || deal.route).trim();
  const origin = (String(deal.route).split(/→|->/)[0] || '').trim();
  const hubSlug = destSlugForText(deal.route);
  const hub = hubSlug ? getDestination(hubSlug) : null;
  const title = `${deal.route} for ${deal.price} return – Mr Cheap Flights`;
  const desc = `${deal.route} from just ${deal.price} return${deal.airline ? ' with ' + deal.airline : ''}. ${deal.dates || ''}${deal.expiry ? ' · Book by ' + deal.expiry : ''}. Hand-picked ${regionName} flight deal — book direct, no commission.`;
  const pageUrl = `${base}/deals/${encodeURIComponent(deal.slug)}`;
  // Booking + fares links route through /api/go (logs the click, then 302s to
  // the real airline/affiliate URL). searchUrl here is only the presence check.
  const searchUrl = routeSearchUrl(deal.route, deal.region, context.env.TRAVELPAYOUTS_MARKER || '');

  const flag = flagInfo(deal.flag);
  // Relative path for the on-page <img> (works on any host incl. previews);
  // absolute URL only where required (og:image, JSON-LD).
  const heroImgRel = deal.image_url || null;
  const heroImg = heroImgRel
    ? (String(heroImgRel).startsWith('/') ? base + heroImgRel : heroImgRel)
    : null;
  const gradient = TYPE_GRADIENTS[deal.dest_type] || TYPE_GRADIENTS.city;

  const priceNum = parsePrice(deal.price);
  const wasNum = parsePrice(deal.was_price);
  const savePct = priceNum && wasNum && wasNum > priceNum ? Math.round((1 - priceNum / wasNum) * 100) : null;
  const currency = String(deal.price).trim().startsWith('£') ? 'GBP' : 'EUR';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        name: deal.route,
        description: desc,
        ...(heroImg ? { image: heroImg } : {}),
        offers: {
          '@type': 'Offer',
          price: String(priceNum ?? '0'),
          priceCurrency: currency,
          availability: 'https://schema.org/InStock',
          url: pageUrl,
          ...(deal.expiry ? { validThrough: deal.expiry } : {}),
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Mr Cheap Flights', item: base + '/' },
          { '@type': 'ListItem', position: 2, name: 'Deals', item: base + '/#deals' },
          { '@type': 'ListItem', position: 3, name: deal.route, item: pageUrl },
        ],
      },
    ],
  };

  const flagHtml = flag
    ? `<img class="flag" src="${flag.img}" width="72" height="54" alt="${esc(deal.flag)}" loading="eager">`
    : `<span class="flag-emoji">${esc(deal.flag || '✈️')}</span>`;

  const relatedHtml = related.map((r) => {
    const rFlag = flagInfo(r.flag);
    const rImg = r.image_url || null;
    const rGrad = TYPE_GRADIENTS[r.dest_type] || TYPE_GRADIENTS.city;
    const media = rImg
      ? `style="background-image:url('${esc(rImg)}');background-size:cover;background-position:center;"`
      : `style="background:${rGrad};"`;
    return `<a class="rel-card" href="${base}/deals/${encodeURIComponent(r.slug)}">
      <div class="rel-media" ${media}>${rFlag ? `<img src="${rFlag.img.replace('w160', 'w80')}" width="34" height="26" alt="${esc(r.flag)}" loading="lazy">` : `<span>${esc(r.flag || '✈️')}</span>`}</div>
      <div class="rel-body">
        <div class="rel-route">${esc(r.route)}</div>
        <div class="rel-dates">${esc(r.dates || '')}</div>
        <div class="rel-price"><small>from</small> ${esc(r.price)}</div>
      </div></a>`;
  }).join('');

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
<meta property="og:image" content="${esc(heroImg || base + '/mascot.png')}">
<meta name="twitter:card" content="${heroImg ? 'summary_large_image' : 'summary'}">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Nunito:wght@600;700;800;900&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%23FFD200'/><text y='78' x='50' text-anchor='middle' font-size='68'>✈</text></svg>">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-M49S3C6SZR"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-M49S3C6SZR');</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
:root{--navy:#060B1F;--card:#0A0F2E;--yellow:#FFD200;--pink:#FF2D78;--teal:#00E5CC;--txt:rgba(255,255,255,.85);--dim:rgba(255,255,255,.5);}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--navy);color:var(--txt);font-family:'Nunito',system-ui,sans-serif;min-height:100vh;}
a{color:inherit;text-decoration:none;}
.nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:.8rem 1.2rem;background:rgba(6,11,31,.92);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,.06);}
.brand{font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:1.5px;color:var(--yellow);}
.brand span{color:var(--pink);}
.nav-cta{background:rgba(255,210,0,.12);border:1.5px solid rgba(255,210,0,.4);color:var(--yellow);font-weight:800;font-size:.82rem;padding:.5rem 1rem;border-radius:50px;white-space:nowrap;}
.hero{position:relative;height:290px;background:${gradient};overflow:hidden;}
${heroImg ? `.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}` : ''}
.hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,11,31,.15) 0%,rgba(6,11,31,.35) 55%,var(--navy) 100%);}
.hero-badge{position:absolute;top:1rem;left:1.2rem;z-index:2;background:rgba(6,11,31,.75);border:1.5px solid rgba(255,45,120,.6);color:var(--pink);font-weight:900;font-size:.78rem;padding:.4rem .9rem;border-radius:50px;letter-spacing:.5px;}
.wrap{max-width:960px;margin:0 auto;padding:0 1.2rem;}
.deal-card{position:relative;z-index:3;margin-top:-110px;background:var(--card);border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:1.8rem 1.6rem;box-shadow:0 24px 60px rgba(0,0,0,.5);}
.deal-head{display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap;}
.flag{border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.45);flex-shrink:0;}
.flag-emoji{font-size:3rem;line-height:1;}
.route{font-family:'Bebas Neue',sans-serif;font-size:clamp(1.9rem,5.5vw,3rem);letter-spacing:1px;color:#fff;line-height:1.02;}
.sub{color:var(--dim);font-weight:700;font-size:.95rem;margin-top:.25rem;}
.airline{display:inline-block;margin-top:.45rem;background:rgba(0,229,204,.1);border:1px solid rgba(0,229,204,.35);color:var(--teal);font-size:.78rem;font-weight:800;padding:.25rem .7rem;border-radius:50px;}
.price-row{display:flex;align-items:flex-end;gap:1.1rem;flex-wrap:wrap;margin:1.4rem 0 .4rem;}
.price-block small{display:block;color:var(--dim);font-weight:700;font-size:.8rem;letter-spacing:1px;text-transform:uppercase;}
.price{font-family:'Bebas Neue',sans-serif;font-size:clamp(3rem,9vw,4.6rem);color:var(--yellow);line-height:.95;}
.was{color:var(--dim);text-decoration:line-through;font-weight:800;font-size:1.15rem;}
.save-pill{background:var(--pink);color:#fff;font-weight:900;font-size:.85rem;padding:.35rem .8rem;border-radius:50px;}
.countdown{display:inline-flex;align-items:center;gap:.45rem;margin:.6rem 0 1rem;background:rgba(255,210,0,.08);border:1px solid rgba(255,210,0,.3);color:var(--yellow);font-weight:800;font-size:.85rem;padding:.45rem .9rem;border-radius:50px;}
.countdown.urgent{background:rgba(255,45,120,.1);border-color:rgba(255,45,120,.5);color:var(--pink);}
.cta-book{display:block;text-align:center;background:var(--yellow);color:var(--navy);font-weight:900;font-size:1.15rem;padding:1.05rem;border-radius:14px;box-shadow:0 10px 30px rgba(255,210,0,.25);transition:transform .15s;}
.cta-book:hover{transform:translateY(-2px);}
.cta-fares{display:block;text-align:center;margin-top:.7rem;color:var(--yellow);font-weight:800;font-size:.95rem;text-decoration:underline;}
.trust-strip{display:flex;justify-content:center;gap:1.4rem;flex-wrap:wrap;margin:1.1rem 0 0;color:var(--dim);font-size:.78rem;font-weight:700;}
.trust-strip span::before{content:'✓ ';color:var(--teal);}
.section{margin:2.6rem 0;}
.section h2{font-family:'Bebas Neue',sans-serif;font-size:1.7rem;letter-spacing:1.5px;color:#fff;margin-bottom:1rem;}
.section h2 em{color:var(--yellow);font-style:normal;}
.signup{background:linear-gradient(135deg,rgba(255,45,120,.14),rgba(255,210,0,.08));border:1px solid rgba(255,45,120,.35);border-radius:18px;padding:1.5rem;text-align:center;}
.signup h3{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:1px;color:#fff;}
.signup p{color:var(--dim);font-weight:700;font-size:.9rem;margin:.3rem 0 1rem;}
.signup-row{display:flex;gap:.6rem;max-width:460px;margin:0 auto;}
.signup-row input{flex:1;min-width:0;background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.15);border-radius:12px;padding:.85rem 1rem;color:#fff;font-family:inherit;font-weight:700;font-size:.95rem;}
.signup-row input::placeholder{color:rgba(255,255,255,.35);}
.signup-row button{background:var(--pink);color:#fff;border:none;border-radius:12px;padding:.85rem 1.3rem;font-family:inherit;font-weight:900;font-size:.95rem;cursor:pointer;white-space:nowrap;}
.signup-ok{display:none;color:var(--teal);font-weight:800;font-size:1.05rem;padding:.6rem 0;}
.rel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.9rem;}
.rel-card{background:var(--card);border:1px solid rgba(255,255,255,.09);border-radius:16px;overflow:hidden;transition:transform .15s,border-color .15s;}
.rel-card:hover{transform:translateY(-3px);border-color:rgba(255,210,0,.45);}
.rel-media{height:110px;display:flex;align-items:center;justify-content:center;font-size:2rem;position:relative;}
.rel-media img{border-radius:6px;box-shadow:0 3px 10px rgba(0,0,0,.4);}
.rel-body{padding: .9rem 1rem 1.1rem;}
.rel-route{font-family:'Bebas Neue',sans-serif;font-size:1.15rem;letter-spacing:.5px;color:#fff;}
.rel-dates{color:var(--dim);font-size:.8rem;font-weight:700;margin:.15rem 0 .5rem;}
.rel-price{color:var(--yellow);font-weight:900;font-size:1.25rem;}
.rel-price small{color:var(--dim);font-weight:700;font-size:.75rem;}
.tips{list-style:none;display:grid;gap:.55rem;}
.tips li{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:.8rem 1rem;font-weight:700;font-size:.9rem;color:var(--txt);}
.tips li::before{content:'✈ ';color:var(--yellow);}
.foot{border-top:1px solid rgba(255,255,255,.07);margin-top:3rem;padding:1.6rem 1.2rem 5.5rem;text-align:center;color:var(--dim);font-size:.8rem;font-weight:700;}
.foot a{color:rgba(255,255,255,.65);text-decoration:underline;}
.foot .tag{font-style:italic;color:rgba(255,255,255,.3);margin-top:.5rem;}
.sticky-bar{position:fixed;bottom:0;left:0;right:0;z-index:60;display:none;align-items:center;gap:.8rem;background:rgba(6,11,31,.96);backdrop-filter:blur(10px);border-top:1px solid rgba(255,255,255,.1);padding:.7rem 1rem calc(.7rem + env(safe-area-inset-bottom));}
.sticky-price{font-family:'Bebas Neue',sans-serif;font-size:1.7rem;color:var(--yellow);line-height:1;}
.sticky-price small{display:block;font-family:'Nunito',sans-serif;font-size:.62rem;color:var(--dim);font-weight:800;letter-spacing:.5px;}
.sticky-bar a{flex:1;text-align:center;background:var(--yellow);color:var(--navy);font-weight:900;font-size:1rem;padding:.85rem;border-radius:12px;}
@media(max-width:720px){.sticky-bar{display:flex;}.deal-card{padding:1.4rem 1.15rem;margin-top:-95px;}.hero{height:240px;}}
</style>
</head>
<body>
<nav class="nav">
  <a class="brand" href="${base}/">MR <span>CHEAP</span> FLIGHTS</a>
  <a class="nav-cta" href="${base}/#deals">All deals →</a>
</nav>

<div class="hero">
  ${heroImgRel ? `<img class="hero-img" src="${esc(heroImgRel)}" alt="${esc(dest)}" fetchpriority="high">` : ''}
  <div class="hero-badge">${esc(deal.badge || '🔥 Hot')}</div>
</div>

<div class="wrap">
  <main class="deal-card">
    <div class="deal-head">
      ${flagHtml}
      <div>
        <h1 class="route">${esc(deal.route)}</h1>
        <div class="sub">${esc(deal.dates || 'Dates flexible')}${/return/i.test(deal.dates || '') ? '' : ' · return'}</div>
        ${deal.airline ? `<span class="airline">✈ ${esc(deal.airline)}</span>` : ''}
      </div>
    </div>

    <div class="price-row">
      <div class="price-block"><small>from</small><div class="price">${esc(deal.price)}</div></div>
      ${deal.was_price ? `<div class="was">${esc(deal.was_price)}</div>` : ''}
      ${savePct ? `<div class="save-pill">SAVE ${savePct}%</div>` : ''}
    </div>

    ${deal.expiry ? `<div class="countdown" id="countdown" data-expiry="${esc(deal.expiry)}">⏳ Book by ${esc(deal.expiry)}</div>` : ''}

    <a class="cta-book" href="/api/go?deal=${deal.id}&kind=book" rel="noopener noreferrer" onclick="gtag('event','deal_book_click',{deal_route:'${esc(deal.route).replace(/'/g, '')}',location:'landing'})">Book This Deal ✈</a>
    ${searchUrl ? `<a class="cta-fares" href="/api/go?deal=${deal.id}&kind=fares" rel="noopener noreferrer">🔍 Compare live fares for these dates</a>` : ''}

    <div class="trust-strip"><span>Book direct with the airline</span><span>No commission, ever</span><span>Deals checked daily</span></div>
  </main>

  <section class="section signup">
    <h3>Never miss another ${esc(dest)} deal</h3>
    <p>Get the best ${regionName} flight deals in your inbox — free, unsubscribe anytime.</p>
    <form class="signup-row" id="su-form">
      <input type="email" id="su-email" placeholder="Your email address…" autocomplete="email" required>
      <button type="submit">Get Free Deals ✈</button>
    </form>
    <div class="signup-ok" id="su-ok">🎉 You're in! Watch your inbox for the next drop.</div>
  </section>

  ${related.length ? `<section class="section"><h2>MORE ${esc(regionName.toUpperCase())} <em>DEALS</em></h2><div class="rel-grid">${relatedHtml}</div></section>` : ''}

  ${hub ? `<section class="section"><a href="${base}/flights-to/${hub.slug}" style="display:block;background:linear-gradient(135deg,rgba(0,229,204,.12),rgba(255,210,0,.08));border:1px solid rgba(0,229,204,.3);border-radius:16px;padding:1.2rem 1.4rem;text-align:center;font-weight:800;color:#fff">🌍 Explore all cheap flights to ${esc(hub.name)} — deals, best times to go & FAQs →</a></section>` : ''}

  <section class="section">
    <h2>BOOKING <em>TIPS</em></h2>
    <ul class="tips">
      <li>Book as soon as possible — fares like this often vanish within days.</li>
      <li>Be flexible ±1–2 days around ${esc(deal.dates || 'the listed dates')} for the lowest prices.</li>
      <li>Check the baggage allowance before you pay — budget fares are usually cabin-bag only.</li>
      <li>Sense-check on Google Flights, then book direct${deal.airline ? ` with ${esc(deal.airline)}` : ' with the airline'}.</li>
    </ul>
  </section>
</div>

<footer class="foot">
  <a href="${base}/">Mr Cheap Flights</a> · <a href="${base}/privacy.html">Privacy</a> · Hand-picked ${regionName} flight deals since 2024
  <div class="tag">Cheap never looked this good.</div>
</footer>

<div class="sticky-bar">
  <div class="sticky-price">${esc(deal.price)}<small>PER PERSON · RETURN</small></div>
  <a href="/api/go?deal=${deal.id}&kind=book" rel="noopener noreferrer" onclick="gtag('event','deal_book_click',{deal_route:'${esc(deal.route).replace(/'/g, '')}',location:'landing_sticky'})">Book Now ✈</a>
</div>

<script>
// Expiry countdown — switches to urgent styling under 3 days.
(function(){
  var el=document.getElementById('countdown');
  if(!el)return;
  var end=new Date(el.dataset.expiry+'T23:59:59');
  function tick(){
    var ms=end-new Date();
    if(ms<=0){el.textContent='⚠️ This deal may have expired — check current fares';el.classList.add('urgent');return;}
    var d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000);
    el.textContent='⏳ '+(d>0?d+' day'+(d===1?'':'s')+' '+h+'h':h+'h '+Math.floor(ms%3600000/60000)+'m')+' left to book';
    if(d<3)el.classList.add('urgent');
  }
  tick();setInterval(tick,60000);
})();
// Email capture → existing /api/signup (sets the member cookie too).
(function(){
  var form=document.getElementById('su-form');
  if(!form)return;
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var email=document.getElementById('su-email').value.trim();
    if(!email)return;
    var btn=form.querySelector('button');btn.disabled=true;btn.textContent='Joining…';
    fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,region:'${region}'})})
      .then(function(r){
        if(r.ok){form.style.display='none';document.getElementById('su-ok').style.display='block';gtag('event','sign_up',{method:'deal_landing'});}
        else{btn.disabled=false;btn.textContent='Get Free Deals ✈';alert('That email doesn\\'t look right — try again?');}
      })
      .catch(function(){btn.disabled=false;btn.textContent='Get Free Deals ✈';});
  });
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
