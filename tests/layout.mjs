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
  await page.close();
}
await browser.close();
console.log('\n' + (problems ? 'LAYOUT: ' + problems + ' PROBLEM(S)' : 'LAYOUT: CLEAN'));
process.exit(problems ? 1 : 0);
