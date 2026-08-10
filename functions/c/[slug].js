// GET /c/:slug — sponsored-campaign landing page.
//
// Paid TikTok/Instagram traffic lands here (not the busy homepage): a single
// hook + email capture, tagged with the campaign source so every signup is
// attributable. Unknown/inactive slug → homepage. Increments a visit counter.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function onRequestGet(context) {
  const isUk = new URL(context.request.url).hostname.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const cur = isUk ? '£' : '€';
  const slug = String(context.params.slug || '').toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(slug)) return Response.redirect(`${base}/`, 302);

  let campaign = null, deals = [];
  try {
    campaign = await context.env.DB.prepare(
      'SELECT slug, name, headline, platform FROM campaigns WHERE slug=? AND active=1'
    ).bind(slug).first();
    if (campaign) {
      context.waitUntil(context.env.DB.prepare(
        'UPDATE campaigns SET visits = visits + 1 WHERE slug=?'
      ).bind(slug).run());
      const { results } = await context.env.DB.prepare(
        `SELECT flag, route, price FROM deals
         WHERE region=? AND status='live' AND (expiry IS NULL OR date(expiry) >= date('now'))
         ORDER BY created_at DESC LIMIT 3`
      ).bind(region).all();
      deals = results || [];
    }
  } catch { /* DB down — still render a capture page below */ }

  if (!campaign) return Response.redirect(`${base}/`, 302);

  const headline = campaign.headline || 'Ridiculously cheap flights, straight to your phone';
  const dealChips = deals.map((d) =>
    `<div class="chip">${esc(d.flag || '✈️')} ${esc(d.route)} <b>${esc(d.price)}</b></div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="${isUk ? 'en-GB' : 'en-IE'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${esc(headline)} | Mr Cheap Flights</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bangers&family=Bebas+Neue&family=Nunito:wght@600;700;800;900&display=swap" rel="stylesheet" crossorigin>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%23FFD200'/><text y='78' x='50' text-anchor='middle' font-size='68'>✈</text></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Nunito',sans-serif;background:radial-gradient(ellipse 90% 55% at 50% 0%,rgba(255,45,120,.14),transparent 60%),linear-gradient(170deg,#060e1c,#0a1628 55%,#08121f);color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem 1.3rem;text-align:center}
.wrap{max-width:440px;width:100%}
.logo{font-family:'Bangers',cursive;font-size:1.6rem;letter-spacing:2px;color:#FFD200;margin-bottom:1.6rem}
.logo span{color:#FF2D78}
.mascot{width:132px;height:132px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,210,0,.5);margin:0 auto 1.3rem;display:block;box-shadow:0 8px 30px rgba(255,45,120,.25)}
h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(2rem,8vw,2.9rem);line-height:1.02;letter-spacing:.5px;margin-bottom:.7rem}
.sub{color:rgba(255,255,255,.62);font-weight:700;font-size:1rem;line-height:1.5;margin-bottom:1.5rem}
form{display:flex;flex-direction:column;gap:.6rem}
input{padding:15px 16px;border-radius:12px;border:1.5px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font-size:1rem;font-weight:700;text-align:center}
input::placeholder{color:rgba(255,255,255,.4)}
button{padding:15px;border-radius:12px;border:none;background:linear-gradient(135deg,#FFD200,#ffb800);color:#0a1628;font-family:'Nunito',sans-serif;font-weight:900;font-size:1.05rem;cursor:pointer;box-shadow:0 8px 26px rgba(255,210,0,.32)}
button:active{transform:translateY(1px)}
.trust{font-size:.78rem;color:rgba(255,255,255,.4);font-weight:700;margin-top:1rem}
.chips{display:flex;flex-direction:column;gap:.45rem;margin-top:1.6rem}
.chip{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:.6rem .8rem;font-size:.9rem;font-weight:800;color:rgba(255,255,255,.75)}
.chip b{color:#FFD200;margin-left:.2rem}
.ok{display:none}
.ok.on{display:block;animation:pop .3s}
@keyframes pop{from{transform:scale(.9);opacity:0}to{transform:none;opacity:1}}
.ok .big{font-family:'Bangers',cursive;font-size:2rem;color:#FFD200;letter-spacing:2px}
.badge{display:inline-block;background:rgba(0,229,204,.12);border:1px solid rgba(0,229,204,.35);color:#00E5CC;font-size:.7rem;font-weight:900;padding:3px 11px;border-radius:20px;letter-spacing:.5px;margin-bottom:1.1rem;text-transform:uppercase}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">MR <span>CHEAP</span> FLIGHTS ✈</div>
  <img class="mascot" src="${base}/mascot-small.jpg" alt="" width="132" height="132" loading="eager"/>
  <div class="badge">✓ Every deal fare-verified</div>
  <div id="form-view">
    <h1>${esc(headline)}</h1>
    <p class="sub">Free deal alerts from ${isUk ? 'UK' : 'Irish'} airports — mistake fares, flash sales, ${cur}-nothing getaways. Join in one tap.</p>
    <form id="f" novalidate>
      <input id="email" type="email" inputmode="email" autocomplete="email" placeholder="Your email address" required/>
      <button type="submit" id="btn">Get Free Deals ✈</button>
    </form>
    <div class="trust">🔒 No spam. Unsubscribe anytime. It's genuinely free.</div>
    ${dealChips ? `<div class="chips">${dealChips}</div>` : ''}
  </div>
  <div class="ok" id="ok-view">
    <div class="big">YOU'RE IN! 🎉</div>
    <p class="sub" style="margin-top:.6rem">Check your inbox — your first deals are on the way. Follow us on ${campaign.platform === 'instagram' ? 'Instagram' : 'TikTok'} for daily drops.</p>
    <a href="${base}/" style="color:#FFD200;font-weight:900;text-decoration:none">See today's deals →</a>
  </div>
</div>
<script>
var SRC=${JSON.stringify(slug)};
document.getElementById('f').addEventListener('submit',function(e){
  e.preventDefault();
  var email=document.getElementById('email').value.trim();
  if(!email||email.indexOf('@')<0){document.getElementById('email').focus();return;}
  var btn=document.getElementById('btn');btn.disabled=true;btn.textContent='Signing you up…';
  fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,region:${JSON.stringify(region)},source:SRC})})
   .then(function(r){
     if(r.ok){document.getElementById('form-view').style.display='none';document.getElementById('ok-view').classList.add('on');
       try{if(window.gtag)gtag('event','sign_up',{method:'campaign',source:SRC});}catch(_){}}
     else{btn.disabled=false;btn.textContent='Get Free Deals ✈';alert('Something went wrong — try again.');}
   })
   .catch(function(){btn.disabled=false;btn.textContent='Get Free Deals ✈';alert('Network error — try again.');});
});
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
