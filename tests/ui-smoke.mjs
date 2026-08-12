const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const URLG = (process.env.GAME_URL || 'file://' + new URL('../game.html', import.meta.url).pathname) + '?debug=1';
const T0 = Date.now();
const log = s => process.stdout.write(
  (s.startsWith('\n') ? '\n' : '') +
  '[' + ((Date.now()-T0)/1000).toFixed(1).padStart(5) + 's] ' + s.replace(/^\n/,'') + '\n');

let fails = 0;
const ok = (cond, name, extra) => {
  if(cond) log('  PASS  ' + name);
  else { fails++; log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: {width: 420, height: 860} });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
// the harness itself blocks the Google Fonts request, so its own abort is
// not a finding
page.on('console', m => {
  if(m.type()!=='error') return;
  if(/Failed to load resource/.test(m.text())) return;
  errors.push('console: '+m.text());
});
await page.route('**fonts.googleapis.com**', r => r.abort());
/* Leaving a match is a two-step (pause, then quit) and the overlay fades in
   between them, so it gets one settled helper rather than racing clicks. */
async function quitToMenu(){
  // already on the menu: there is nothing to quit, and the title screen
  // sits over the pause button
  if(!(await page.locator('#ovTitle').getAttribute('class')).includes('hidden')) return;
  // a promotion screen legitimately blocks everything behind it
  if(!(await page.locator('#ovRank').getAttribute('class')).includes('hidden')){
    await page.click('#bRankOn');
    await page.waitForSelector('#ovRank.hidden');
  }
  await page.click('#bPause');
  await page.waitForSelector('#ovPause:not(.hidden)');
  await page.waitForTimeout(200);
  await page.click('#bQuit');
  await page.waitForSelector('#ovTitle:not(.hidden)');
  await page.waitForTimeout(200);
}
await page.goto(URLG, {waitUntil:'domcontentloaded'});
await page.waitForTimeout(700);

log('\n— boot —');
ok(errors.length === 0, 'no page errors on boot', errors.join(' | '));
ok(await page.evaluate(()=>window.__cfBoot) === 'wired', 'boot reached the wiring block');
ok((await page.textContent('#bootmsg')).includes('ready'), 'boot message says ready');

log('\n— every control is wired —');
const IDS = ['bChamp','bQuick','bFree','bSurv','bDuel','bOnline','bDaily','bTrain',
             'bKit','bCab','bSet','bPause','bMute','bResume','bRestart','bQuit',
             'bSetClose','bCabClose','bRankOn','bCoach','bAgain','bSpot','bNext',
             'bPass','bKitClose','bOnlineClose','bPauseSet'];
for(const id of IDS){
  const wired = await page.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && typeof el.onclick === 'function';
  }, id);
  ok(wired, 'button #' + id + ' exists and has a handler');
}

log('\n— settings —');
await page.click('#bSet');
ok(!(await page.locator('#ovSet').getAttribute('class')).includes('hidden'), 'settings screen opens');
const rowCount = await page.locator('#optList .opt').count();
ok(rowCount >= 6, 'the settings screen is populated', 'got ' + rowCount);
/* Addressed BY NAME, not by index. Positional selectors here meant that
   adding one row — Music — failed three unrelated assertions and said
   nothing about which setting had actually moved. */
const row = name => page.locator('#optList .opt', { hasText: name }).first();
for (const n of ['Sound', 'Music', 'Vibration', 'Aim line', 'Left-handed']) {
  ok(await row(n).count() > 0, 'settings offers "' + n + '"');
}
// flip the aim line off and confirm it persists to storage
await row('Aim line').click();
const previewOff = await page.evaluate(()=>{
  const o = JSON.parse(localStorage.getItem('crokerFlicks.opts'));
  return o.preview === false;
});
ok(previewOff, 'aim-line toggle writes through to storage');
await row('Aim line').click();                          // back on

// music has a switch of its own, separate from Sound
await row('Music').click();
ok(await page.evaluate(()=>{
  const o = JSON.parse(localStorage.getItem('crokerFlicks.opts'));
  return o.music === false && o.sound === true;
}), 'music can be stopped without silencing the game');
await row('Music').click();
// graphics cycles
const g1 = await page.textContent('#optList .opt:last-child .optv');
await page.click('#optList .opt:last-child');
const g2 = await page.textContent('#optList .opt:last-child .optv');
ok(g1 !== g2, 'graphics setting cycles', g1 + ' -> ' + g2);
await page.click('#optList .opt:last-child');
await page.click('#optList .opt:last-child');           // back to HIGH
// left-handed moves the furniture
await row('Left-handed').click();
ok(await page.evaluate(()=>document.body.classList.contains('lefty')), 'left-handed flips the layout');
await row('Left-handed').click();
await page.click('#bSetClose');

log('\n— trophy cabinet —');
await page.click('#bCab');
const cabRows = await page.locator('#cabList .trow').count();
ok(cabRows >= 12, 'cabinet lists the awards', 'rows=' + cabRows);
ok((await page.textContent('#cabAll')) === String(cabRows), 'cabinet total matches the list');
await page.click('#bCabClose');

log('\n— coach marks on the very first kick —');
await page.click('#bQuick');
await page.waitForTimeout(900);
ok(!(await page.locator('#ovCoach').getAttribute('class')).includes('hidden'), 'coach marks appear');
ok(await page.evaluate(()=>document.querySelectorAll('#coachDots span').length) === 7, 'seven coaching cards');
for(let i=0;i<7;i++) await page.click('#bCoach');
ok((await page.locator('#ovCoach').getAttribute('class')).includes('hidden'), 'coach marks dismiss');
ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('crokerFlicks.v2')).seenCoach),
   'coach marks are remembered');

log('\n— pause —');
await page.click('#bPause');
ok(!(await page.locator('#ovPause').getAttribute('class')).includes('hidden'), 'pause overlay opens');
ok((await page.textContent('#pauseSub')).length > 3, 'pause shows the live scoreline');
await page.click('#bResume');
ok((await page.locator('#ovPause').getAttribute('class')).includes('hidden'), 'resume closes it');
await page.keyboard.press('Escape');
ok(!(await page.locator('#ovPause').getAttribute('class')).includes('hidden'), 'Escape pauses');
await page.keyboard.press('Escape');
ok((await page.locator('#ovPause').getAttribute('class')).includes('hidden'), 'Escape resumes');

log('\n— keyboard aiming —');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('KeyE');
const readout = await page.evaluate(()=>({
  pwr: document.getElementById('pwrNum').textContent,
  aim: document.getElementById('aimNum').textContent,
  curl: document.getElementById('curlNum').textContent,
  live: document.body.classList.contains('dragging'),
}));
ok(readout.live, 'keyboard aim activates the readout');
ok(readout.pwr !== '0%', 'arrow keys change power', JSON.stringify(readout));
ok(readout.aim.includes('▶'), 'right arrow aims right', readout.aim);
ok(readout.curl.includes('curl'), 'E applies curl', readout.curl);
await page.keyboard.press('Space');
await page.waitForTimeout(400);
ok(await page.evaluate(()=>!document.body.classList.contains('dragging')
   && document.getElementById('prompt').style.display === 'none'),
   'space strikes the ball and clears the aim state');

log('\n— a full quick match plays out —');
/* Wait on the game's own state rather than a fixed sleep. A goal triggers a
   replay and the opponent's turn has its own timings, so any fixed delay is
   either slow or a race. */
let saves = 0, dives = 0;
async function waitTurn(budget){
  const t0 = Date.now();
  while(Date.now() - t0 < (budget || 15000)){
    const st = await page.evaluate(()=>({
      aim:  window.CF.canAim,
      keep: window.CF.canKeep,
      end:  !document.getElementById('ovEnd').classList.contains('hidden'),
      rank: !document.getElementById('ovRank').classList.contains('hidden'),
    }));
    if(st.rank){ await page.click('#bRankOn'); continue; }
    // the opponent's kick is ours to save now, so the loop has to dive
    if(st.keep){
      const side = (dives++ % 2) ? 2.2 : -2.2;
      await page.evaluate(x => window.CF.keepAt(x, 0.9), side);
      await page.waitForTimeout(120);
      continue;
    }
    if(st.end || st.aim) return st;
    await page.waitForTimeout(150);
  }
  return {timeout:true};
}
/* Vary the kick. One fixed gesture missed almost every time, so the scores
   stayed level and the match kept going to sudden death — which has no cap,
   and turned a 45-second test into a three-minute one at random. Swipes are
   dispatched with real delays because the model reads pace off the clock. */
const KICKS = [
  [[ 18,-40],[ 40,-80],[ 62,-120]],
  [[-18,-40],[-40,-80],[-62,-120]],
  [[  0,-70],[  0,-150],[  0,-230],[0,-300]],
  [[ 30,-30],[ 60,-60],[ 90,-88]],
  [[  0,-40],[ 16,-78],[ 44,-104]],
  [[-30,-50],[-58,-96],[-82,-138]],
];
async function takeKick(i){
  const pts = KICKS[i % KICKS.length];
  const at = (type, dx, dy) => page.evaluate(a => {
    const cv = document.getElementById('c'), r = cv.getBoundingClientRect();
    const ev = new MouseEvent(a[0], {clientX:r.left+r.width*0.5+a[1],
                                     clientY:r.top+r.height*0.78+a[2], bubbles:true});
    (a[0] === 'mousedown' ? cv : window).dispatchEvent(ev);
  }, [type, dx, dy]);
  await at('mousedown', 0, 0);
  for(const d of pts){ await at('mousemove', d[0], d[1]); await page.waitForTimeout(18); }
  const last = pts[pts.length-1];
  await at('mouseup', last[0], last[1]);
}
/* A promotion holds the game until it is acknowledged, and it lands mid-match
   whenever the run happens to cross a rank threshold — so the next click hits
   the overlay instead of the pitch and the match never finishes. A player taps
   CARRY ON; so does this. It was an intermittent failure that said "the match
   reaches full time" and meant nothing of the kind. */
const carryOn = async () => {
  const up = await page.evaluate(() =>
    !document.getElementById('ovRank').classList.contains('hidden'));
  if(up){ await page.click('#bRankOn'); await page.waitForTimeout(250); }
};
let turn = await waitTurn(), kicks = 0;
for(; kicks<30 && !turn.end && !turn.timeout; kicks++){
  await carryOn();
  await takeKick(kicks);
  await page.waitForTimeout(200);
  await carryOn();
  turn = await waitTurn();
}
await carryOn();
const ended = await page.evaluate(()=>!document.getElementById('ovEnd').classList.contains('hidden'));
log('  (took ' + kicks + ' kicks)');
ok(ended, 'the match reaches full time');
ok((await page.locator('#gCard .crow').count()) > 0, 'end screen shows the kick-by-kick card');
ok((await page.locator('#gCard .cflag').count()) >= (await page.locator('#gCard .crow').count()),
   'every card row carries a flag');

log('\n— opponent pips —');
const pips = await page.evaluate(()=>({
  mine: document.querySelectorAll('#pips .pip').length,
  theirs: document.querySelectorAll('#pipsC .pip').length,
  theirsMarked: [...document.querySelectorAll('#pipsC .pip')].filter(p=>p.className!=='pip').length,
}));
ok(pips.theirs > 0, 'the opponent has a pip row', JSON.stringify(pips));
ok(pips.theirsMarked > 0, 'the opponent pips actually show results', JSON.stringify(pips));

log('\n— play again —');
await page.click('#bAgain');
await page.waitForTimeout(700);
ok((await page.locator('#ovEnd').getAttribute('class')).includes('hidden'), 'play again restarts without the menu');
await quitToMenu();
ok(!(await page.locator('#ovTitle').getAttribute('class')).includes('hidden'), 'quit returns to the menu');

log('\n— daily challenge —');
await page.click('#bDaily');
await page.waitForTimeout(800);
const daily = await page.evaluate(()=>({
  label: document.getElementById('rbL').textContent,
  kick: document.getElementById('rnd').textContent,
}));
ok(daily.label.startsWith('DAILY'), 'daily labels the round bar', daily.label);
ok(daily.kick === '1/5', 'daily is five kicks', daily.kick);
await quitToMenu();

log('\n— training ground —');
await page.click('#bTrain');
await page.waitForTimeout(800);
const t1 = await page.textContent('#rbL');
ok(t1.startsWith('TRAINING'), 'training labels the round bar', t1);
ok(await page.evaluate(()=>getComputedStyle(document.getElementById('bSpot')).display) === 'block',
   'the spot switcher is visible in training');
ok(await page.evaluate(()=>getComputedStyle(document.getElementById('betbar')).opacity) === '0',
   'no wagering on the training ground');
await page.click('#bSpot');
await page.waitForTimeout(400);
const t2 = await page.textContent('#rbL');
ok(t1 !== t2, 'the spot switcher moves the ball', t1 + ' -> ' + t2);
// the training ground must not touch the ledger
const xpBefore = await page.evaluate(()=>JSON.parse(localStorage.getItem('crokerFlicks.v2')).xp);
await page.evaluate(()=>{
  const cv=document.getElementById('c'), r=cv.getBoundingClientRect();
  cv.dispatchEvent(new MouseEvent('mousedown',{clientX:r.left+r.width*.5,clientY:r.top+r.height*.7,bubbles:true}));
  window.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+r.width*.5,clientY:r.top+r.height*.7+140,bubbles:true}));
  window.dispatchEvent(new MouseEvent('mouseup',{clientX:r.left+r.width*.5,clientY:r.top+r.height*.7+140,bubbles:true}));
});
await page.waitForTimeout(2600);
const xpAfter = await page.evaluate(()=>JSON.parse(localStorage.getItem('crokerFlicks.v2')).xp);
ok(xpBefore === xpAfter, 'training banks no points', xpBefore + ' -> ' + xpAfter);
await quitToMenu();

log('\n— keeper tell —');
await page.waitForTimeout(300);
await page.click('#bQuick');
await page.waitForTimeout(900);
// the tell has to be honest: it must be read off the reaction time that was
// already drawn, not invented for the label
const tell = await page.evaluate(()=>{
  const seen = [];
  for(let i=0;i<40;i++){
    const r = window.CF.simulate({matchSeed:900+i, kickIndex:i%5, power:.6, aimM:0,
                                  curl:0, x:0, z:11, wall:0, difficulty:'senior'});
    seen.push(r.outcome);
  }
  return {sim: seen.length};
});
ok(tell.sim === 40, 'the seeded core still replays with the tell in place');

log('\n— the swipe reads the shot —');
/* Probed on the training ground: no clock, no opponent, and the next kick is
   handed straight back, so each gesture is measured in isolation instead of
   racing a shootout. */
await quitToMenu();
await page.click('#bTrain');
await page.waitForTimeout(900);

async function waitAim(){
  for(let i=0;i<60;i++){
    if(await page.evaluate(()=>window.CF.canAim)) return true;
    if(await page.evaluate(()=>window.CF.canKeep))
      await page.evaluate(()=>window.CF.keepAt(0, 1.2));
    await page.waitForTimeout(200);
  }
  return false;
}
/* Dispatch a real swipe: points go out with genuine delays, because the model
   reads pace off the clock and a burst of same-tick events is not a gesture. */
async function swipe(points, stepMs){
  const ready = await waitAim();
  if(!ready) return {failed:true};
  const at = (type, dx, dy) => page.evaluate(a => {
    const cv = document.getElementById('c'), r = cv.getBoundingClientRect();
    const ev = new MouseEvent(a[0], {clientX:r.left+r.width*0.5+a[1],
                                     clientY:r.top+r.height*0.78+a[2], bubbles:true});
    (a[0] === 'mousedown' ? cv : window).dispatchEvent(ev);
  }, [type, dx, dy]);
  await at('mousedown', 0, 0);
  for(const d of points){ await at('mousemove', d[0], d[1]); await page.waitForTimeout(stepMs); }
  const read = await page.evaluate(()=>({
    aim: window.CF.aimState,
    zone: window.CF.litZone,
    elevTxt: document.getElementById('elevNum').textContent,
    dial: document.getElementById('curlNeedle').style.width,
  }));
  const last = points[points.length-1];
  await at('mouseup', last[0], last[1]);
  await page.waitForTimeout(150);
  return read;
}

const quick = await swipe([[0,-30],[0,-60],[0,-90],[0,-120]], 12);
const slow  = await swipe([[0,-30],[0,-60],[0,-90],[0,-120]], 95);
ok(!quick.failed && !slow.failed, 'the probes landed on a live kick');
ok(quick.aim.power > slow.aim.power + 0.2,
   'swiping faster strikes it harder', JSON.stringify([quick.aim.power, slow.aim.power]));
ok(Math.abs(quick.aim.elev - slow.aim.elev) < 0.08,
   'pace does not drag the loft with it', JSON.stringify([quick.aim.elev, slow.aim.elev]));

const long  = await swipe([[0,-60],[0,-130],[0,-200],[0,-270],[0,-330]], 25);
const short = await swipe([[0,-25],[0,-50],[0,-70]], 25);
ok(long.aim.elev > short.aim.elev + 0.25,
   'swiping further lifts it', JSON.stringify([long.aim.elev, short.aim.elev]));
ok(/lofted|floated/.test(long.elevTxt) && /low|driven/.test(short.elevTxt),
   'and the readout names both', long.elevTxt + ' vs ' + short.elevTxt);

const right = await swipe([[12,-40],[26,-80],[42,-120]], 20);
const left  = await swipe([[-12,-40],[-26,-80],[-42,-120]], 20);
ok(right.aim.aimM > 0.8, 'swiping right aims right', JSON.stringify(right.aim));
ok(left.aim.aimM < -0.8, 'swiping left aims left', JSON.stringify(left.aim));
const wide = await swipe([[46,-38],[96,-72],[150,-104]], 20);
ok(Math.abs(wide.aim.aimM) > 3.3 && wide.zone && !wide.zone.lit,
   'swiping hard across sends it outside the posts, and nothing lights',
   JSON.stringify([wide.aim.aimM, wide.zone]));

log('\n— the target area lights up as you swipe —');
ok(quick.zone && quick.zone.lit, 'a zone is lit while swiping', JSON.stringify(quick.zone));
ok(right.zone && left.zone && right.zone.col > left.zone.col,
   'aiming to the other side lights the other side',
   JSON.stringify([right.zone, left.zone]));
ok(long.zone && long.zone.over, 'a long sweep lights the band over the bar',
   JSON.stringify(long.zone));

log('\n— curl follows the finger —');
const straight = await swipe([[0,-30],[0,-60],[0,-90],[0,-120],[0,-150]], 18);
const hooked   = await swipe([[0,-30],[0,-60],[14,-92],[42,-116],[76,-132]], 18);
const mirror   = await swipe([[0,-30],[0,-60],[-14,-92],[-42,-116],[-76,-132]], 18);
const curls = {straight:straight.aim.curl, hooked:hooked.aim.curl, mirror:mirror.aim.curl};
ok(Math.abs(curls.straight) < 0.12, 'a straight swipe has no bend', JSON.stringify(curls));
ok(Math.abs(curls.hooked) > 0.3, 'bending the swipe bends the ball', JSON.stringify(curls));
ok(Math.sign(curls.hooked) === -Math.sign(curls.mirror),
   'mirroring the bend mirrors it', JSON.stringify(curls));
ok(hooked.dial !== '' && hooked.dial !== '0%', 'the curl dial moves with it',
   'straight=' + straight.dial + ' hooked=' + hooked.dial);

log('\n— no clock on the training ground —');
const tclock = await page.evaluate(()=>({
  bar: document.getElementById('shotbar').className, n: window.CF.stateName,
}));
ok(!tclock.bar.includes('show'), 'training is untimed', JSON.stringify(tclock));
await waitAim();
await page.waitForTimeout(1600);
ok(await page.evaluate(()=>window.CF.canAim),
   'and it stays your kick for as long as you like',
   await page.evaluate(()=>window.CF.stateName));

log('\n— the shot clock —');
await quitToMenu();
await page.click('#bQuick');
await page.waitForTimeout(900);
const clock0 = await page.evaluate(()=>({
  shown: document.getElementById('shotbar').className, left: window.CF.shotClock,
}));
ok(clock0.shown.includes('show'), 'the clock is showing on a kick', clock0.shown);
ok(clock0.left > 0 && clock0.left <= 5.01, 'it starts at five seconds', String(clock0.left));
await page.waitForTimeout(1500);
const clock1 = await page.evaluate(()=>window.CF.shotClock);
ok(clock1 < clock0.left - 1, 'it runs down', clock0.left + ' -> ' + clock1);
/* Wait on the game's own clock, not the wall's. A frame is capped at 33ms of
   simulated time, so a loaded machine drops frames and in-game seconds run
   slower than real ones — a fixed sleep here reports a working clock as a
   broken one. */
for(let i=0; i<200 && await page.evaluate(()=>window.CF.shotClock) > 0; i++){
  await page.waitForTimeout(80);
}
await page.waitForTimeout(400);
const after = await page.evaluate(()=>({
  n: window.CF.stateName, bar: document.getElementById('shotbar').className,
}));
ok(after.n !== 'AIM', 'running it down takes the kick anyway', JSON.stringify(after));
ok(!after.bar.includes('show'), 'and stops the clock', after.bar);

log('\n— wind is spelled out —');
const windUI = await page.evaluate(()=>({
  val: document.getElementById('wVal').textContent,
  desc: document.getElementById('wDesc').textContent,
  fill: document.getElementById('wFill').style.width,
  arrow: document.getElementById('wArr').textContent,
}));
ok(/CALM|LIGHT|FRESH|STRONG/.test(windUI.desc), 'wind strength is named', JSON.stringify(windUI));
ok(windUI.fill !== '', 'wind strength has a bar', JSON.stringify(windUI));
ok(windUI.desc === 'CALM' || /L\u2192R|R\u2192L/.test(windUI.desc),
   'wind direction is spelled out', JSON.stringify(windUI));

log('\n— you play in goal —');
await quitToMenu();
await page.click('#bQuick');
await page.waitForTimeout(900);
/* Budget by the clock, not by iterations, and keep a trace: when this fails
   the useful question is which states it actually saw, not that it gave up. */
let sawKeep = false, keepState = null, seen = [], kicks2 = 0;
const deadline = Date.now() + 45000;
while(!sawKeep && Date.now() < deadline){
  const st = await page.evaluate(()=>({
    n: window.CF.stateName, keep: window.CF.canKeep, aim: window.CF.canAim,
    goalie: window.CF.goalieOn,
    end: !document.getElementById('ovEnd').classList.contains('hidden'),
    rank: !document.getElementById('ovRank').classList.contains('hidden'),
    bar: document.getElementById('keepbar').className,
  }));
  if(seen[seen.length-1] !== st.n) seen.push(st.n);
  if(st.keep){ sawKeep = true; keepState = st; break; }
  if(st.rank){ await page.click('#bRankOn'); continue; }
  if(st.end){ await page.click('#bAgain'); await page.waitForTimeout(900); continue; }
  if(st.aim){ await takeKick(kicks2++); }
  await page.waitForTimeout(160);
}
ok(sawKeep, "the opponent's kick hands you the gloves",
   'states seen: ' + seen.join('>') + ' after ' + kicks2 + ' kicks');
if(sawKeep){
  ok(keepState.bar.includes('show'), 'the save clock is showing', keepState.bar);
  /* The window has to span the strike, or the only dive available is a guess
     made before the ball is hit — which is the one the forward reads. Hold
     off until it is struck and check the gloves are still live. */
  const late = await page.evaluate(()=>new Promise(resolve=>{
    const t0 = Date.now();
    const tick = () => {
      const c = window.CF.kickClock;
      if(Date.now() - t0 > 6000) return resolve({timeout:true});
      if(!c || !c.struck) return requestAnimationFrame(tick);
      // the strike lands in the pre-flight branch, so the flight HUD it hands
      // over to has not drawn yet — give it the frame it is owed
      requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({
        struck:true, live:window.CF.canKeep, label:
          document.getElementById('keepLbl').firstChild.nodeValue.trim()})));
    };
    requestAnimationFrame(tick);
  }));
  ok(late.struck && late.live,
     'the gloves stay live after he strikes, so a late dive is possible',
     JSON.stringify(late));
  ok(late.label === 'BALL AWAY', 'and the bar says so', JSON.stringify(late));
  const before = await page.evaluate(()=>window.CF.keepCommitted);
  await page.evaluate(()=>window.CF.keepAt(2.4, 1.0));
  await page.waitForTimeout(150);
  const after = await page.evaluate(()=>({
    committed: window.CF.keepCommitted, clock: window.CF.kickClock,
  }));
  ok(!before && after.committed, 'the flick commits the dive',
     JSON.stringify(after));
  ok(!after.clock.struck || after.clock.t >= after.clock.strikeAt,
     'and the striker keeps his own clock rather than waiting for you',
     JSON.stringify(after.clock));
  await page.waitForTimeout(3000);
  const rec = await page.evaluate(()=>{
    const pr = JSON.parse(localStorage.getItem('crokerFlicks.v2'));
    return {faced:pr.faced||0, saves:pr.saves||0};
  });
  ok(rec.faced > 0, 'the kick you faced is recorded', JSON.stringify(rec));
}

log('\n— the keeper is told what is coming —');
await quitToMenu();
await page.click('#bQuick');
await page.waitForTimeout(900);
let tel = null, swerves = 0, looked = 0;
const tdead = Date.now() + 60000;
while(looked < 4 && Date.now() < tdead){
  const st = await page.evaluate(()=>({
    keep: window.CF.canKeep, aim: window.CF.canAim,
    end: !document.getElementById('ovEnd').classList.contains('hidden'),
    rank: !document.getElementById('ovRank').classList.contains('hidden'),
  }));
  if(st.rank){ await page.click('#bRankOn'); continue; }
  if(st.end){ await page.click('#bAgain'); await page.waitForTimeout(800); continue; }
  if(st.keep){
    const g = await page.evaluate(()=>window.CF.telegraph);
    if(g){
      looked++;
      if(!tel) tel = g;
      if(g.swerve >= 0.30) swerves++;
    }
    await page.evaluate(()=>{ const g=window.CF.telegraph;
      window.CF.keepAt(g ? g.shown.x : 0, g ? g.shown.y : 1.2); });
    await page.waitForTimeout(2600);
    continue;
  }
  if(st.aim) await takeKick(looked);
  await page.waitForTimeout(200);
}
ok(tel !== null, 'the shot exists before the window closes', JSON.stringify(tel));
if(tel){
  ok(typeof tel.shown.x === 'number' && typeof tel.shown.y === 'number',
     'there is a line to read', JSON.stringify(tel.shown));
  ok(tel.shown.x !== tel.clean.x,
     'and it is offset by your read error, not handed to you',
     JSON.stringify([tel.shown.x, tel.clean.x]));
  ok(looked >= 2, 'more than one kick was faced', 'looked=' + looked);
}
ok(await page.evaluate(()=>window.CF.keepWindow) > 3,
   'the window is long enough to read it',
   String(await page.evaluate(()=>window.CF.keepWindow)));

log('\n— the shop is shelved by county —');
await quitToMenu();
await page.click('#bKit');
await page.waitForTimeout(250);
const shop = await page.evaluate(()=>({
  heads: [...document.querySelectorAll('#kitList .shophead b')].map(e=>e.textContent),
  rows: document.querySelectorAll('#kitList .kit').length,
}));
ok(shop.heads.length >= 4, 'the shop has shelves', JSON.stringify(shop.heads));
ok(shop.heads.some(h=>/GOALKEEPER/.test(h)), 'goalkeeper jerseys are on sale', JSON.stringify(shop.heads));
ok(shop.heads.some(h=>/MATCH BALL/.test(h)), 'match balls are on sale', JSON.stringify(shop.heads));
ok(shop.rows > 20, 'more to buy than before', 'rows=' + shop.rows);
await page.click('#bKitClose');
const county = await page.evaluate(()=>{
  const cells=[...document.querySelectorAll('#cs .cty')].filter(c=>!c.className.includes('locked'));
  cells[1].click();
  return cells[1].querySelector('.cn').textContent;
});
await page.click('#bKit');
await page.waitForTimeout(200);
const head0 = await page.textContent('#kitList .shophead b');
ok(head0 === county.toUpperCase(), 'the first shelf follows the county you picked',
   county + ' vs ' + head0);
await page.click('#bKitClose');

log('\n— a promotion holds the game —');
await quitToMenu();
await page.click('#bQuick');
await page.waitForTimeout(900);
const held = await page.evaluate(async ()=>{
  const label0 = window.CF.kickLabel;
  window.CF.rankUpNow();
  const shown = !document.getElementById('ovRank').classList.contains('hidden');
  const wasPaused = window.CF.paused;
  await new Promise(r=>setTimeout(r, 1400));
  return {shown, wasPaused, label0, label1: window.CF.kickLabel,
          stillPaused: window.CF.paused};
});
ok(held.shown, 'the rank screen appears');
ok(held.wasPaused, 'it stops the simulation');
ok(held.label0 === held.label1, 'nothing advances behind it',
   held.label0 + ' -> ' + held.label1);
await page.click('#bRankOn');
await page.waitForTimeout(400);
ok(await page.evaluate(()=>!window.CF.paused), 'carrying on resumes the game');
ok((await page.locator('#ovRank').getAttribute('class')).includes('hidden'), 'the rank screen closes');

log('\n— errors across the whole run —');
ok(errors.length === 0, 'no runtime errors at any point', errors.slice(0,4).join(' | '));

await browser.close();
log('\n' + (fails ? 'SMOKE: ' + fails + ' FAILED' : 'SMOKE: ALL PASSED'));
process.exit(fails ? 1 : 0);
