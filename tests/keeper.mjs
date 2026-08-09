/* Is the keeper half actually playable, and is there a decision in it?
 *
 * A kick is a duel on one clock. The keeper may throw himself whenever he
 * likes, and the two ways of doing it are genuinely different:
 *
 *   early   go before he strikes. You get there — but he watches you go and
 *           puts it the other side, so the telegraph you just read is stale.
 *   late    go once the ball is struck. He cannot react to you any more and
 *           the read is honest — but you have far less ground to cover in.
 *
 * Each is run blind (dive at random) and shown (dive at the telegraph). The
 * shape we want:
 *   - late/shown clearly beats late/blind      -> reading the shot pays
 *   - early/shown is NOT far ahead of early/blind -> going early costs secrecy
 *   - neither is anywhere near total           -> the striker still has a game
 */
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const GAME = (process.env.GAME_URL ||
  'file://' + new URL('../game.html', import.meta.url).pathname) + '?debug=1';
const N = +(process.env.N || 14);

async function run(when, strategy, tier){
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

  let faced = 0, saved = 0, early = 0;
  const deadline = Date.now() + 300000;
  while(faced < N && Date.now() < deadline){
    const st = await p.evaluate(()=>({
      keep: window.CF.canKeep, aim: window.CF.canAim,
      end: !document.getElementById('ovEnd').classList.contains('hidden'),
      rank: !document.getElementById('ovRank').classList.contains('hidden'),
    }));
    if(st.rank){ await p.click('#bRankOn'); continue; }
    if(st.end){ await p.click('#bAgain'); await p.waitForTimeout(800); continue; }
    if(st.keep){
      /* The dive is committed from inside one frame callback, so the decision
         and the throw happen at the same instant on the kick clock — no
         round-trip latency smearing the timing being measured. */
      const res = await p.evaluate(([w, strat]) => new Promise(resolve => {
        const tick = () => {
          const c = window.CF.kickClock, g = window.CF.telegraph;
          if(!window.CF.canKeep) return resolve(null);
          if(!c || !g) return requestAnimationFrame(tick);
          // early: most of the way to the strike. late: the ball is gone.
          const ready = w === 'early' ? (c.strikeAt && c.t >= c.strikeAt*0.78 && !c.struck)
                                      : c.struck;
          if(!ready) return requestAnimationFrame(tick);
          let pt;
          if(strat === 'blind') pt = {x:(Math.random()*2-1)*3.2, y:0.2+Math.random()*2.2};
          else if(w === 'late') pt = window.CF.telegraph.real;   // struck: honest
          else pt = g.swerve >= 0.30 ? g.shownEnd : g.shown;
          const before = !c.struck;
          resolve(window.CF.keepAt(pt.x, pt.y) ? {before} : null);
        };
        requestAnimationFrame(tick);
      }), [when, strategy]);
      if(res){
        faced++; if(res.before) early++;
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
  return {faced, saved, early, pct: faced ? Math.round(saved/faced*100) : 0};
}

const out = {};
for(const tier of (process.env.TIERS || 'senior').split(',')){
  for(const when of (process.env.WHENS || 'early,late').split(',')){
    for(const strat of (process.env.STRATS || 'blind,shown').split(',')){
      const r = await run(when, strat, tier);
      out[when+'/'+strat] = r.pct;
      console.log(tier.padEnd(12) + when.padEnd(7) + strat.padEnd(7) +
        r.saved + '/' + r.faced + '  ' + String(r.pct).padStart(3) + '% kept out' +
        '   (' + r.early + ' of ' + r.faced + ' before the strike)');
    }
  }
}

const has = k => out[k] !== undefined;
let bad = 0;
if(has('late/shown') && has('late/blind')){
  const gap = out['late/shown'] - out['late/blind'];
  console.log('\nreading the shot is worth ' + gap + ' points when you go late');
  if(gap < 15){ console.log('FAIL: the telegraph is decoration'); bad++; }
}
if(has('early/shown') && has('late/shown')){
  console.log('going early rather than late is worth ' +
    (out['early/shown'] - out['late/shown']) + ' points');
}
for(const k in out) if(out[k] > 85){ console.log('FAIL: ' + k + ' keeps out ' + out[k] + '%'); bad++; }
console.log(bad ? '\nKEEPER: FAIL' : '\nKEEPER: PASS');
process.exit(bad ? 1 : 0);
