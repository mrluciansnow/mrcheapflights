// GET /promo/:code — redeem-a-promo landing page. An influencer's audience
// lands here; enter email → claim a comped premium trial. Unknown/inactive
// code → homepage.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function onRequestGet(context) {
  const isUk = new URL(context.request.url).hostname.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const code = String(context.params.code || '').trim().toUpperCase();

  if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(code)) return Response.redirect(`${base}/`, 302);

  let promo = null;
  try {
    promo = await context.env.DB.prepare(
      'SELECT code, trial_days, max_redemptions, redeemed_count FROM promo_codes WHERE code=? AND active=1'
    ).bind(code).first();
  } catch { /* fall through */ }
  if (!promo) return Response.redirect(`${base}/`, 302);

  const soldOut = promo.max_redemptions != null && promo.redeemed_count >= promo.max_redemptions;
  const days = promo.trial_days;

  const html = `<!DOCTYPE html>
<html lang="${isUk ? 'en-GB' : 'en-IE'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Claim ${days} days Premium free | Mr Cheap Flights</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bangers&family=Bebas+Neue&family=Nunito:wght@600;700;800;900&display=swap" rel="stylesheet" crossorigin>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%23FFD200'/><text y='78' x='50' text-anchor='middle' font-size='68'>✈</text></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Nunito',sans-serif;background:radial-gradient(ellipse 90% 55% at 50% 0%,rgba(255,45,120,.16),transparent 60%),linear-gradient(170deg,#060e1c,#0a1628 55%,#08121f);color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem 1.3rem;text-align:center}
.wrap{max-width:440px;width:100%}
.logo{font-family:'Bangers',cursive;font-size:1.5rem;letter-spacing:2px;color:#FFD200;margin-bottom:1.4rem}
.logo span{color:#FF2D78}
.ticket{background:linear-gradient(135deg,rgba(255,45,120,.14),rgba(255,210,0,.08));border:1.5px dashed rgba(255,210,0,.5);border-radius:18px;padding:1.6rem 1.3rem;margin-bottom:1.4rem}
.ticket .code{font-family:'Bebas Neue',sans-serif;font-size:1.7rem;letter-spacing:3px;color:#00E5CC}
.days{font-family:'Bangers',cursive;font-size:3.4rem;color:#FFD200;line-height:1;margin:.3rem 0}
h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(1.6rem,6vw,2.2rem);margin-bottom:.5rem}
.sub{color:rgba(255,255,255,.62);font-weight:700;font-size:.95rem;line-height:1.5;margin-bottom:1.3rem}
ul{list-style:none;text-align:left;max-width:300px;margin:0 auto 1.4rem;font-size:.9rem;font-weight:700;color:rgba(255,255,255,.72)}
li{padding:.28rem 0}
form{display:flex;flex-direction:column;gap:.6rem}
input{padding:15px 16px;border-radius:12px;border:1.5px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font-size:1rem;font-weight:700;text-align:center}
input::placeholder{color:rgba(255,255,255,.4)}
button{padding:15px;border-radius:12px;border:none;background:linear-gradient(135deg,#FFD200,#ffb800);color:#0a1628;font-weight:900;font-size:1.05rem;cursor:pointer}
button:disabled{opacity:.6}
.fine{font-size:.75rem;color:rgba(255,255,255,.38);font-weight:700;margin-top:.9rem}
.ok,.sold{display:none}
.ok.on,.sold.on{display:block}
.ok .big{font-family:'Bangers',cursive;font-size:2.2rem;color:#FFD200;letter-spacing:2px}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">MR <span>CHEAP</span> FLIGHTS ✈</div>
  ${soldOut ? `
  <div class="sold on">
    <div class="ticket"><div class="code">${esc(code)}</div></div>
    <h1>This code is fully claimed 😅</h1>
    <p class="sub">Too slow this time! Grab our free deals instead — the next drop could be the one.</p>
    <a href="${base}/" style="color:#FFD200;font-weight:900;text-decoration:none">Get free deals →</a>
  </div>` : `
  <div id="form-view">
    <div class="ticket">
      <div class="code">🎟 ${esc(code)}</div>
      <div class="days">${days}</div>
      <div style="font-weight:900;letter-spacing:1px;color:#fff">DAYS PREMIUM — FREE</div>
    </div>
    <h1>Unlock every deal, free for ${days} days</h1>
    <ul>
      <li>⚡ Instant mistake-fare alerts</li>
      <li>🔓 Premium-only deals (long-haul + featured)</li>
      <li>🔎 Verified flight details on every deal</li>
      <li>🔔 Destination price alerts</li>
    </ul>
    <form id="f" novalidate>
      <input id="email" type="email" inputmode="email" autocomplete="email" placeholder="Your email address" required/>
      <button type="submit" id="btn">Claim my ${days} days ✈</button>
    </form>
    <div class="fine">No card needed. Free for ${days} days, then it simply reverts to free — nothing auto-charges.</div>
  </div>
  <div class="ok" id="ok-view">
    <div class="ticket"><div class="big">PREMIUM UNLOCKED! ⭐</div></div>
    <p class="sub" style="margin-top:.8rem">You've got ${days} days of full access. Check your inbox — then go find a bargain.</p>
    <a href="${base}/" style="color:#FFD200;font-weight:900;text-decoration:none">See premium deals →</a>
  </div>`}
</div>
<script>
var CODE=${JSON.stringify(code)};
var f=document.getElementById('f');
if(f){f.addEventListener('submit',function(e){
  e.preventDefault();
  var email=document.getElementById('email').value.trim();
  if(!email||email.indexOf('@')<0){document.getElementById('email').focus();return;}
  var btn=document.getElementById('btn');btn.disabled=true;btn.textContent='Unlocking…';
  fetch('/api/promo/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:CODE,email:email,region:${JSON.stringify(region)}})})
   .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
   .then(function(x){
     if(x.ok){document.getElementById('form-view').style.display='none';document.getElementById('ok-view').classList.add('on');
       try{if(window.gtag)gtag('event','promo_redeem',{code:CODE});}catch(_){}}
     else{btn.disabled=false;btn.textContent='Claim my ${days} days ✈';alert((x.d&&x.d.error)||'Could not redeem — try again.');}
   })
   .catch(function(){btn.disabled=false;btn.textContent='Claim my ${days} days ✈';alert('Network error — try again.');});
});}
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
