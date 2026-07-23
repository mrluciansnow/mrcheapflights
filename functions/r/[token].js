// GET /r/:token — referral landing.
//
// A subscriber shares /r/<their member_token>. We validate the token, drop an
// mcf_ref cookie (consumed by /api/signup), and show a friendly one-tap capture.
// Unknown token → homepage. The referrer is credited when the friend signs up.

import { setCookieHeader } from '../_lib/auth.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const isUk = url.hostname.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const cur = isUk ? '£' : '€';
  const token = String(context.params.token || '').toLowerCase();

  if (!/^[a-f0-9]{40,64}$/.test(token)) return Response.redirect(`${base}/`, 302);

  // Validate the token belongs to a real subscriber; grab a few live deals.
  let referrer = null, deals = [];
  try {
    referrer = await context.env.DB.prepare('SELECT id FROM subscribers WHERE member_token=?').bind(token).first();
    if (referrer) {
      const { results } = await context.env.DB.prepare(
        `SELECT flag, route, price FROM deals
         WHERE region=? AND status='live' AND (expiry IS NULL OR date(expiry) >= date('now'))
         ORDER BY created_at DESC LIMIT 3`
      ).bind(region).all();
      deals = results || [];
    }
  } catch { /* DB down — fall through to redirect */ }

  if (!referrer) return Response.redirect(`${base}/`, 302);

  const dealChips = deals.map((d) =>
    `<div class="chip">${esc(d.flag || '✈️')} ${esc(d.route)} <b>${esc(d.price)}</b></div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="${isUk ? 'en-GB' : 'en-IE'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>A mate sent you cheap flights | Mr Cheap Flights</title>
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
.badge{display:inline-block;background:rgba(255,45,120,.12);border:1px solid rgba(255,45,120,.35);color:#FF6FA5;font-size:.7rem;font-weight:900;padding:3px 11px;border-radius:20px;letter-spacing:.5px;margin-bottom:1.1rem;text-transform:uppercase}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">MR <span>CHEAP</span> FLIGHTS ✈</div>
  <img class="mascot" src="${base}/mascot-small.jpg" alt="" width="132" height="132" loading="eager"/>
  <div class="badge">🎁 A mate sent you in</div>
  <div id="form-view">
    <h1>Your mate reckons you're overpaying for flights</h1>
    <p class="sub">They just handed you the cheap-flights club — free, fare-verified deal alerts from ${isUk ? 'UK' : 'Irish'} airports. Mistake fares, flash sales, ${cur}-nothing getaways. Join in one tap.</p>
    <form id="f" novalidate>
      <input id="email" type="email" inputmode="email" autocomplete="email" placeholder="Your email address" required/>
      <button type="submit" id="btn">Get Free Deals ✈</button>
    </form>
    <div class="trust">🔒 No spam. Unsubscribe anytime. It's genuinely free.</div>
    ${dealChips ? `<div class="chips">${dealChips}</div>` : ''}
  </div>
  <div class="ok" id="ok-view">
    <div class="big">YOU'RE IN! 🎉</div>
    <p class="sub" style="margin-top:.6rem">Check your inbox — your first deals are on the way. Want your own free Premium? Share your link once you're in.</p>
    <a href="${base}/" style="color:#FFD200;font-weight:900;text-decoration:none">See today's deals →</a>
  </div>
</div>
<script>
document.getElementById('f').addEventListener('submit',function(e){
  e.preventDefault();
  var email=document.getElementById('email').value.trim();
  if(!email||email.indexOf('@')<0){document.getElementById('email').focus();return;}
  var btn=document.getElementById('btn');btn.disabled=true;btn.textContent='Signing you up…';
  fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,region:${JSON.stringify(region)},source:'referral'})})
   .then(function(r){
     if(r.ok){document.getElementById('form-view').style.display='none';document.getElementById('ok-view').classList.add('on');
       try{if(window.gtag)gtag('event','sign_up',{method:'referral'});}catch(_){}}
     else{btn.disabled=false;btn.textContent='Get Free Deals ✈';alert('Something went wrong — try again.');}
   })
   .catch(function(){btn.disabled=false;btn.textContent='Get Free Deals ✈';alert('Network error — try again.');});
});
</script>
</body>
</html>`;

  // Drop the referral cookie (consumed by /api/signup). Secure only on https so
  // it still sets on plain-http local dev.
  const secure = url.protocol === 'https:';
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Set-Cookie': setCookieHeader('mcf_ref', token, { maxAgeSeconds: 60 * 60 * 24 * 30, httpOnly: true, sameSite: 'Lax', secure }),
    },
  });
}
