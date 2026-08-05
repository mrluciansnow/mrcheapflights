const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const GAME = process.env.GAME_URL || 'file://' + new URL('../game.html', import.meta.url).pathname;
let problems = 0;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for(const vp of [{width:360,height:640,n:'small phone'},
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
    const get = el => { if(!el) return null; const r = el.getBoundingClientRect();
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
    return out;
  });
  const hit = (a,b) => a && b && !(a.r<=b.x || b.r<=a.x || a.b<=b.y || b.b<=a.y);
  console.log('\n=== ' + vp.n + ' ' + vp.width + 'x' + vp.height + ' ===');
  for(const [k,v] of Object.entries(boxes)) console.log('  ' + k.padEnd(7), JSON.stringify(v));
  const pairs = [['rbL','gDist'],['rbL','gWind'],['rank','stakes'],['rank','note'],
                 ['stakes','note'],['sb','rbL'],['rank','rbL']];
  for(const [a,b] of pairs)
    if(hit(boxes[a], boxes[b])){ problems++; console.log('  OVERLAP: ' + a + ' x ' + b); }
  // measure the text, not the centred block it sits in
  const clipped = await page.evaluate(()=>{
    const ids = ['betNote','rbL','rbV','nmP','nmC'];
    return ids.filter(i => { const e = document.getElementById(i);
      return e && e.scrollWidth > e.clientWidth + 1; });
  });
  if(clipped.length){ problems++; console.log('  CLIPPED TEXT: ' + clipped.join(', ')); }
  await page.close();
}
await browser.close();
console.log('\n' + (problems ? 'LAYOUT: ' + problems + ' PROBLEM(S)' : 'LAYOUT: CLEAN'));
process.exit(problems ? 1 : 0);
