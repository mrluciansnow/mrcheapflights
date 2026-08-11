const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const GAME = process.env.GAME_URL || 'file://' + new URL('../game.html', import.meta.url).pathname;
let problems = 0;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
/* The composition assumes a portrait frame. Outside this band the goal either
   squashes flat or stretches, so the stage letterboxes rather than fill. */
const RATIO_MIN = 0.43, RATIO_MAX = 0.63;

/* The extremes are where fitting breaks, so they are in the probe: a folding
   phone is far narrower than the scene is composed for, and a phone held
   sideways is wider than tall. Both used to distort the pitch and overlap the
   title screen's text. */
for(const vp of [{width:344,height:882,n:'folding phone'},
                 {width:852,height:393,n:'phone in landscape'},
                 {width:360,height:640,n:'small phone'},
                 {width:420,height:860,n:'tall phone'},
                 {width:540,height:940,n:'desktop stage'}]){
  const page = await browser.newPage({viewport:{width:vp.width, height:vp.height}});
  await page.route('**fonts.googleapis.com**', r=>r.abort());
  await page.goto(GAME, {waitUntil:'domcontentloaded'});
  await page.evaluate(()=>localStorage.setItem('crokerFlicks.v2', JSON.stringify({v:2,seenCoach:true,xp:1305,money:780,unlocked:['Dublin'],kit:'std',kits:['std'],awards:[]})));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(400);
  await page.click('#bQuick');
  await page.waitForTimeout(900);

  const boxes = await page.evaluate(()=>{
    const ids = ['rbL','gDist','gWind','rankbarRK','stakes','betNote','pips','pipsC','prompt','meter','readout','bSpot'];
    const out = {};
    /* An element nobody can see cannot collide with anything. The timed bars
       sit 8px high while they are faded out, which read as an overlap with
       the rank strip until this skipped them. */
    const get = el => {
      if(!el) return null;
      const cs = getComputedStyle(el);
      if(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
      const r = el.getBoundingClientRect();
      return {x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height),
              r:Math.round(r.right), b:Math.round(r.bottom)}; };
    out.rbL   = get(document.getElementById('rbL'));
    out.gDist = get(document.getElementById('gDist'));
    out.gWind = get(document.getElementById('gWind'));
    out.rank  = get(document.querySelector('.rankbar'));
    out.stakes= get(document.getElementById('stakes'));
    out.note  = get(document.getElementById('betNote'));
    out.pips  = get(document.getElementById('pips'));
    out.pipsC = get(document.getElementById('pipsC'));
    out.sb    = get(document.querySelector('.sb'));
    out.stage = get(document.getElementById('stage'));
    // the timed bars and the wagering chips have collided once already
    out.shotbar = get(document.getElementById('shotbar'));
    out.keepbar = get(document.getElementById('keepbar'));
    out.prompt  = get(document.getElementById('prompt'));
    return out;
  });
  const hit = (a,b) => a && b && !(a.r<=b.x || b.r<=a.x || a.b<=b.y || b.b<=a.y);
  console.log('\n=== ' + vp.n + ' ' + vp.width + 'x' + vp.height + ' ===');
  for(const [k,v] of Object.entries(boxes)) console.log('  ' + k.padEnd(7), JSON.stringify(v));
  const pairs = [['rbL','gDist'],['rbL','gWind'],['rank','stakes'],['rank','note'],
                 ['stakes','note'],['sb','rbL'],['rank','rbL'],
                 ['shotbar','stakes'],['shotbar','note'],['shotbar','rank'],
                 ['keepbar','stakes'],['keepbar','rank'],['stakes','prompt']];
  for(const [a,b] of pairs)
    if(hit(boxes[a], boxes[b])){ problems++; console.log('  OVERLAP: ' + a + ' x ' + b); }
  // Measure the text, not the centred block it sits in. Elements that declare
  // text-overflow:ellipsis are allowed to truncate — that is the design — so
  // only unintended overflow counts. (This probe blocks webfonts, so the
  // fallback face is wider here than in production; without the exemption a
  // long county name trips it on the runs that draw one.)
  const clipped = await page.evaluate(()=>{
    const ids = ['betNote','rbL','rbV','nmP','nmC','aimNum','elevNum','curlNum','wDesc'];
    return ids.filter(i => {
      const e = document.getElementById(i);
      if(!e || e.scrollWidth <= e.clientWidth + 1) return false;
      return getComputedStyle(e).textOverflow !== 'ellipsis';
    });
  });
  if(clipped.length){ problems++; console.log('  CLIPPED TEXT: ' + clipped.join(', ')); }

  /* Fit: the stage has to stay inside the viewport it was given, and inside
     the aspect band the pitch is drawn for. Both were broken — landscape gave
     1.46 and a folding phone 0.39, against a scene composed for 0.57. */
  const fit = await page.evaluate(()=>{
    const r = document.getElementById('stage').getBoundingClientRect();
    return {w:r.width, h:r.height, vw:innerWidth, vh:innerHeight,
            scroll: document.documentElement.scrollHeight > innerHeight + 1};
  });
  const ratio = fit.w / fit.h;
  console.log('  fit     ' + Math.round(fit.w) + 'x' + Math.round(fit.h) +
              '  ratio ' + ratio.toFixed(2));
  if(fit.h > fit.vh + 1 || fit.w > fit.vw + 1){
    problems++; console.log('  OVERFLOWS THE VIEWPORT');
  }
  if(ratio < RATIO_MIN || ratio > RATIO_MAX){
    problems++; console.log('  OUT OF ASPECT BAND: ' + ratio.toFixed(2));
  }
  if(fit.scroll){ problems++; console.log('  THE PAGE ITSELF SCROLLS'); }

  /* The panels that only appear during an online match. They are hidden on
     every run above, so nothing here was ever measured — and a chat drawer
     pinned to the bottom of a 393px-tall landscape phone is exactly the shape
     of thing that covers the goal or pushes the page into scrolling. */
  const panels = await page.evaluate(()=>{
    const out = {};
    /* A full-screen overlay is SUPPOSED to fill the screen, so the failure to
       look for is not its size but its content: anything wider than the
       overlay cannot be reached at all, and anything much taller than it means
       the buttons are below the fold on the shortest phone. */
    const overlay = (id, fn) => {
      const el = document.getElementById(id);
      el.classList.remove('hidden');
      if(fn) fn();
      out[id] = {wide: el.scrollWidth > el.clientWidth + 1,
                 overflows: el.scrollHeight > el.clientHeight + 1,
                 screens: +(el.scrollHeight / Math.max(1, el.clientHeight)).toFixed(2)};
      el.classList.add('hidden');
    };
    /* A panel inside the pitch has the opposite job: stay inside it. */
    const panel = (id, fn) => {
      const st = document.getElementById('stage').getBoundingClientRect();
      const el = document.getElementById(id);
      el.classList.remove('hidden');
      if(fn) fn();
      const r = el.getBoundingClientRect();
      out[id] = {w:Math.round(r.width), h:Math.round(r.height),
                 outside: r.right > st.right + 1 || r.left < st.left - 1 ||
                          r.bottom > st.bottom + 1 || r.top < st.top - 1,
                 tall: r.height > st.height * 0.6};
      el.classList.add('hidden');
    };
    overlay('ovTut', () => window.CF && window.CF.tutorial && window.CF.tutorial(0));
    /* The lobby as it actually looks once two people are in it: the ways in
       are gone by then, so showing them alongside the ready panel would be
       measuring a screen nobody sees. */
    overlay('ovOnline', () => {
      for(const id of ['mpPick','mpCodeWrap','mpJoinCode','bJoinGo'])
        document.getElementById(id).classList.add('hidden');
      document.getElementById('mpReady').classList.remove('hidden');
    });
    document.getElementById('mpReady').classList.add('hidden');
    document.getElementById('mpPick').classList.remove('hidden');
    panel('talk');
    /* The microphone spent a release underneath the wind gauge, where it was
       drawn, measurable, and impossible to press. */
    {
      const t = document.getElementById('talk');
      t.classList.remove('hidden');
      const r = t.getBoundingClientRect();
      const w = document.getElementById('gWind').getBoundingClientRect();
      out.talkVsWind = {clash: !(r.right <= w.left || w.right <= r.left ||
                                 r.bottom <= w.top || w.bottom <= r.top)};
      t.classList.add('hidden');
    }
    panel('chatWrap', () => {
      const log = document.getElementById('chatLog');
      for(let i=0;i<8;i++){
        const p = document.createElement('p');
        p.className = i%2 ? 'me' : 'them';
        p.textContent = 'a line of chat long enough to wrap on a narrow phone ' + i;
        log.appendChild(p);
      }
    });
    out.scroll = document.documentElement.scrollHeight > innerHeight + 1;
    return out;
  });
  for(const [k,v] of Object.entries(panels)){
    if(k === 'scroll') continue;
    console.log('  ' + k.padEnd(9), JSON.stringify(v));
    if(v.wide){ problems++; console.log('  PANEL WIDER THAN THE SCREEN: ' + k); }
    // scrolling is fine; needing more than a screen and a half is not
    if(v.screens > 1.5){ problems++; console.log('  PANEL NEEDS ' + v.screens + ' SCREENS: ' + k); }
    if(v.outside){ problems++; console.log('  PANEL OUTSIDE THE STAGE: ' + k); }
    if(v.tall){ problems++; console.log('  PANEL SWALLOWS THE PITCH: ' + k); }
    if(v.clash){ problems++; console.log('  BURIED UNDER THE HUD: ' + k); }
  }
  if(panels.scroll){ problems++; console.log('  A PANEL MADE THE PAGE SCROLL'); }
  await page.close();
}
await browser.close();
console.log('\n' + (problems ? 'LAYOUT: ' + problems + ' PROBLEM(S)' : 'LAYOUT: CLEAN'));
process.exit(problems ? 1 : 0);
