/* Is the keeper half actually playable now?
 * Three players face the same kicks:
 *   blind   dives at random
 *   shown   dives at whatever the telegraph is showing
 *   truth   dives at where the ball will really finish
 * If shown is not well clear of blind, the telegraph is decoration. If shown
 * is level with truth, the read error is doing nothing.
 */
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const GAME = (process.env.GAME_URL ||
  'file://' + new URL('../game.html', import.meta.url).pathname) + '?debug=1';
const N = 14;

async function run(strategy, tier){
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p = await b.newPage({viewport:{width:400,height:800}});
  await p.route('**fonts.googleapis.com**', r=>r.abort());
  await p.goto(GAME, {waitUntil:'domcontentloaded'});
  await p.evaluate(t => localStorage.setItem('crokerFlicks.v2', JSON.stringify({
    v:2, seenCoach:true, xp:20000, money:9000, unlocked:['Dublin'],
    kit:'std', kits:['std'], awards:[], gk:'gk-std', gks:['gk-std'],
    ball:'ball-std', balls:['ball-std'],
  })), tier);
  await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForTimeout(400);
  await p.evaluate(t => { const cells=[...document.querySelectorAll('#ds .dif')];
    const hit = cells.find(c=>c.textContent.toLowerCase().includes(t)); if(hit) hit.click(); }, tier);
  await p.click('#bQuick');
  await p.waitForTimeout(900);

  let faced = 0, saved = 0;
  const deadline = Date.now() + 240000;
  while(faced < N && Date.now() < deadline){
    const st = await p.evaluate(()=>({
      n: window.CF.stateName, keep: window.CF.canKeep, aim: window.CF.canAim,
      end: !document.getElementById('ovEnd').classList.contains('hidden'),
      rank: !document.getElementById('ovRank').classList.contains('hidden'),
    }));
    if(st.rank){ await p.click('#bRankOn'); continue; }
    if(st.end){ await p.click('#bAgain'); await p.waitForTimeout(800); continue; }
    if(st.keep){
      // wait until past the swerve window so the reader has seen everything
      for(let i=0;i<40;i++){
        const g = await p.evaluate(()=>window.CF.telegraph);
        if(!g || g.prog > 0.74) break;
        await p.waitForTimeout(60);
      }
      const res = await p.evaluate(strat => {
        const g = window.CF.telegraph;
        if(!g) return null;
        let pt;
        if(strat === 'blind') pt = {x:(Math.random()*2-1)*3.2, y:0.2+Math.random()*2.2};
        else if(strat === 'shown') pt = g.swerve >= 0.30 ? g.shownEnd : g.shown;
        else pt = g.real;
        window.CF.keepAt(pt.x, pt.y);
        return true;
      }, strategy);
      if(res){
        faced++;
        // let the kick resolve, then read the result panel
        for(let i=0;i<60;i++){
          const done = await p.evaluate(()=>window.CF.stateName);
          if(done === 'AIM' || done === 'OVER' || done === 'RESULT') break;
          await p.waitForTimeout(80);
        }
        await p.waitForTimeout(900);
        const out = await p.evaluate(()=>document.querySelector('#res .big').textContent);
        if(/SAVED|TIPPED|POST|BAR|WIDE|SHORT|BLOCKED/.test(out)) saved++;
      }
      continue;
    }
    if(st.aim){
      // a plain kick, just to move the game on
      await p.evaluate(()=>{
        const cv=document.getElementById('c'), r=cv.getBoundingClientRect();
        cv.dispatchEvent(new MouseEvent('mousedown',{clientX:r.left+200,clientY:r.top+620,bubbles:true}));
      });
      for(const d of [[6,-40],[16,-80],[26,-118]]){
        await p.evaluate(k=>{const cv=document.getElementById('c'),r=cv.getBoundingClientRect();
          window.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+200+k[0],clientY:r.top+620+k[1],bubbles:true}));},d);
        await p.waitForTimeout(16);
      }
      await p.evaluate(()=>{const cv=document.getElementById('c'),r=cv.getBoundingClientRect();
        window.dispatchEvent(new MouseEvent('mouseup',{clientX:r.left+226,clientY:r.top+502,bubbles:true}));});
    }
    await p.waitForTimeout(140);
  }
  await b.close();
  return {faced, saved, pct: faced ? Math.round(saved/faced*100) : 0};
}

for(const tier of (process.env.TIERS || 'senior').split(',')){
  for(const strat of (process.env.STRATS || 'blind,shown').split(',')){
    const r = await run(strat, tier);
    console.log(tier.padEnd(12) + strat.padEnd(7) + r.saved + '/' + r.faced + '  ' + r.pct + '% kept out');
  }
}
