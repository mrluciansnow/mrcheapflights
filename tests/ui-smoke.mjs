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
ok(rowCount === 6, 'six settings rows (five toggles + graphics)', 'got ' + rowCount);
// flip the aim line off and confirm it persists to storage
await page.locator('#optList .opt').nth(2).click();
const previewOff = await page.evaluate(()=>{
  const o = JSON.parse(localStorage.getItem('crokerFlicks.opts'));
  return o.preview === false;
});
ok(previewOff, 'aim-line toggle writes through to storage');
await page.locator('#optList .opt').nth(2).click();     // back on
// graphics cycles
const g1 = await page.textContent('#optList .opt:last-child .optv');
await page.click('#optList .opt:last-child');
const g2 = await page.textContent('#optList .opt:last-child .optv');
ok(g1 !== g2, 'graphics setting cycles', g1 + ' -> ' + g2);
await page.click('#optList .opt:last-child');
await page.click('#optList .opt:last-child');           // back to HIGH
// left-handed moves the furniture
await page.locator('#optList .opt').nth(4).click();
ok(await page.evaluate(()=>document.body.classList.contains('lefty')), 'left-handed flips the layout');
await page.locator('#optList .opt').nth(4).click();
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
ok(await page.evaluate(()=>document.querySelectorAll('#coachDots span').length) === 4, 'four coaching cards');
for(let i=0;i<4;i++) await page.click('#bCoach');
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
/* Vary the kick. One fixed drag missed almost every time, so the scores stayed
   level and the match kept going to sudden death — which has no cap, and turned
   a 45-second test into a three-minute one at random. */
const KICKS = [[-60,48], [55,77], [-30,80], [20,154], [70,52], [-45,95]];
function takeKick(i){
  return page.evaluate(k=>{
    const cv = document.getElementById('c');
    const r = cv.getBoundingClientRect();
    const x0 = r.left + r.width*0.5, y0 = r.top + r.height*0.72;
    cv.dispatchEvent(new MouseEvent('mousedown', {clientX:x0, clientY:y0, bubbles:true}));
    window.dispatchEvent(new MouseEvent('mousemove', {clientX:x0+k[0], clientY:y0+k[1], bubbles:true}));
    window.dispatchEvent(new MouseEvent('mouseup',   {clientX:x0+k[0], clientY:y0+k[1], bubbles:true}));
  }, KICKS[i % KICKS.length]);
}
let turn = await waitTurn(), kicks = 0;
for(; kicks<30 && !turn.end && !turn.timeout; kicks++){
  await takeKick(kicks);
  await page.waitForTimeout(200);
  turn = await waitTurn();
}
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

log('\n— aiming: reticle, elevation and the accuracy cone —');
await quitToMenu();
await page.click('#bQuick');
await page.waitForTimeout(900);

/* Run a drag and read what the game made of it, then back the finger out to
   the anchor so the shot is NOT taken — otherwise every probe costs a kick
   and the match is over before the next assertion. */
async function gesture(points){
  for(let i=0;i<40;i++){
    if(await page.evaluate(()=>window.CF.canAim)) break;
    await page.waitForTimeout(200);
  }
  return page.evaluate(pts => {
    const cv = document.getElementById('c'), r = cv.getBoundingClientRect();
    const x0 = r.left + r.width*0.5, y0 = r.top + r.height*0.55;
    cv.dispatchEvent(new MouseEvent('mousedown', {clientX:x0, clientY:y0, bubbles:true}));
    for(const [dx,dy] of pts)
      window.dispatchEvent(new MouseEvent('mousemove', {clientX:x0+dx, clientY:y0+dy, bubbles:true}));
    const read = window.CF.aimState;
    const elevTxt = document.getElementById('elevNum').textContent;
    const dial = document.getElementById('curlNeedle').style.width;
    // cancel: back to the anchor drops the power under the firing threshold
    window.dispatchEvent(new MouseEvent('mousemove', {clientX:x0, clientY:y0, bubbles:true}));
    window.dispatchEvent(new MouseEvent('mouseup',   {clientX:x0, clientY:y0, bubbles:true}));
    return {read, elevTxt, dial};
  }, points);
}

const down = await gesture([[0,30],[0,60],[0,90],[0,120]]);
ok(Math.abs(down.read.aimM) < 0.2, 'a straight-down pull aims down the middle', JSON.stringify(down.read));
ok(down.read.elev > 0.9, 'a straight-down pull is lofted', JSON.stringify(down.read));
ok(down.read.power > 0.5, 'pull length still sets the power', JSON.stringify(down.read));

const flat = await gesture([[40,-12],[80,-25],[120,-38]]);
ok(flat.read.aimM < -1.5, 'pulling right aims left, slingshot style', JSON.stringify(flat.read));
ok(flat.read.elev < 0.4, 'pulling up under the ball drives it low', JSON.stringify(flat.read));
ok(/low|driven|level|floated|lofted/.test(flat.elevTxt), 'the elevation is named on screen', flat.elevTxt);

// power and elevation are genuinely independent now
const softHigh = await gesture([[0,20],[0,40]]);
const hardHigh = await gesture([[0,60],[0,120],[0,180]]);
ok(Math.abs(softHigh.read.elev - hardHigh.read.elev) < 0.05 &&
   hardHigh.read.power - softHigh.read.power > 0.3,
   'power moves without dragging elevation with it',
   JSON.stringify([softHigh.read, hardHigh.read]));

log('\n— curl follows the finger —');
const straight = await gesture([[0,20],[0,40],[0,60],[0,80],[0,100],[0,120]]);
const hooked   = await gesture([[0,20],[0,40],[0,60],[16,80],[38,96],[64,108]]);
const mirror   = await gesture([[0,20],[0,40],[0,60],[-16,80],[-38,96],[-64,108]]);
const curls = {straight:straight.read.curl, hooked:hooked.read.curl, mirror:mirror.read.curl};
ok(Math.abs(curls.straight) < 0.1, 'a straight pull has no bend', JSON.stringify(curls));
ok(Math.abs(curls.hooked) > 0.35, 'hooking the pull bends it', JSON.stringify(curls));
ok(Math.sign(curls.hooked) === -Math.sign(curls.mirror),
   'mirroring the hook mirrors the bend', JSON.stringify(curls));
ok(hooked.dial !== '' && hooked.dial !== '0%', 'the curl dial moves with it',
   'straight=' + straight.dial + ' hooked=' + hooked.dial);

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
let sawKeep = false, keepState = null;
for(let i=0;i<40 && !sawKeep;i++){
  const st = await page.evaluate(()=>({
    n: window.CF.stateName, keep: window.CF.canKeep, aim: window.CF.canAim,
    end: !document.getElementById('ovEnd').classList.contains('hidden'),
    bar: document.getElementById('keepbar').className,
  }));
  if(st.keep){ sawKeep = true; keepState = st; break; }
  if(st.end){ await page.click('#bAgain'); await page.waitForTimeout(900); continue; }
  if(st.aim) await takeKick(i);
  await page.waitForTimeout(350);
}
ok(sawKeep, "the opponent's kick hands you the gloves", JSON.stringify(keepState));
if(sawKeep){
  ok(keepState.bar.includes('show'), 'the save clock is showing', keepState.bar);
  const before = await page.evaluate(()=>window.CF.stateName);
  await page.evaluate(()=>window.CF.keepAt(2.4, 1.0));
  await page.waitForTimeout(150);
  const after = await page.evaluate(()=>({n:window.CF.stateName,
    bar:document.getElementById('keepbar').className}));
  ok(before === 'KEEP' && after.n !== 'KEEP', 'choosing a dive commits it', before+' -> '+after.n);
  ok(!after.bar.includes('show'), 'the clock stops once you have chosen');
  await page.waitForTimeout(3000);
  const rec = await page.evaluate(()=>{
    const pr = JSON.parse(localStorage.getItem('crokerFlicks.v2'));
    return {faced:pr.faced||0, saves:pr.saves||0};
  });
  ok(rec.faced > 0, 'the kick you faced is recorded', JSON.stringify(rec));
}

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
