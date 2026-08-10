/* The daily challenge claims that everyone playing on a given day faces the
 * same five kicks — same placements, same wind, same weather, same keeper —
 * with no server involved. That only holds if the whole board derives from the
 * date through the seeded stream. This proves it across two independent
 * browser contexts, which is the closest local stand-in for two players.
 *
 *   node tests/daily.mjs
 */
const PW = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const GAME = (process.env.GAME_URL ||
  'file://' + new URL('../game.html', import.meta.url).pathname) + '?debug=1';
const log = s => process.stdout.write(s + '\n');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/* Two contexts means two separate localStorage stores and two separate JS
   realms — nothing is shared but the date. */
async function board(profileXp){
  const ctx = await browser.newContext({viewport:{width:400, height:820}});
  const page = await ctx.newPage();
  await page.route('**fonts.googleapis.com**', r => r.abort());
  await page.goto(GAME, {waitUntil:'domcontentloaded'});
  await page.evaluate(xp => localStorage.setItem('crokerFlicks.v2', JSON.stringify({
    v:2, seenCoach:true, xp:xp, money:500, unlocked:['Dublin'], kit:'std',
    kits:['std'], awards:[],
  })), profileXp);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(400);
  await page.click('#bDaily');
  await page.waitForTimeout(900);

  const kicks = [];
  for(let i=0;i<5;i++){
    kicks.push(await page.evaluate(()=>({
      spot:   document.getElementById('rbL').textContent,
      ground: document.getElementById('rbV').textContent,
      dist:   document.getElementById('distV').textContent,
      wind:   document.getElementById('wVal').textContent,
      arrow:  document.getElementById('wArr').textContent,
    })));
    if(i === 4) break;
    // strike it however: the conditions for the next kick are already fixed
    await page.evaluate(()=>{
      const cv = document.getElementById('c'), r = cv.getBoundingClientRect();
      cv.dispatchEvent(new MouseEvent('mousedown',{clientX:r.left+r.width*.5,clientY:r.top+r.height*.7,bubbles:true}));
      window.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+r.width*.5+20,clientY:r.top+r.height*.7+150,bubbles:true}));
      window.dispatchEvent(new MouseEvent('mouseup',{clientX:r.left+r.width*.5+20,clientY:r.top+r.height*.7+150,bubbles:true}));
    });
    for(let w=0; w<80; w++){
      if(await page.evaluate(()=>window.CF.canAim)) break;
      await page.waitForTimeout(150);
    }
  }
  await ctx.close();
  return kicks;
}

// deliberately different profiles: rank and money must not leak into the board
const a = await board(0);
const b = await board(9000);

let bad = 0;
log('kick   placement                            ground / wind          match');
for(let i=0;i<5;i++){
  const same = JSON.stringify(a[i]) === JSON.stringify(b[i]);
  if(!same) bad++;
  log('  ' + (i+1) + '    ' + a[i].spot.padEnd(36).slice(0,36) + ' '
      + (a[i].ground.split(' · ')[0] + ' ' + a[i].wind + a[i].arrow).padEnd(22).slice(0,22)
      + ' ' + (same ? 'yes' : 'NO — ' + JSON.stringify(b[i])));
}
await browser.close();
log('\nidentical kicks : ' + (5-bad) + '/5');
log(bad ? 'DAILY BOARD: MISMATCH' : 'DAILY BOARD: PASS');
process.exit(bad ? 1 : 0);
