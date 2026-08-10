const PW = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const GAME_URL=(process.env.GAME_URL || 'file://'+new URL('../game.html', import.meta.url).pathname)+'?debug=1';
const log=s=>process.stdout.write(s+'\n');

const RECORDS = [];
for(let i=0;i<40;i++){
  RECORDS.push({
    matchSeed: 100000+i*7919, kickIndex: i%7,
    power: 0.2+((i*13)%80)/100, aimM: -3+((i*7)%60)/10, curl: -0.8+((i*11)%17)/10,
    x: [0,12,-24,33,-6][i%5], z: [11,45,38,34,32][i%5],
    wall: [0,0,0,2,3][i%5], difficulty:['junior','senior','allireland'][i%3],
  });
}

// --- run 1: fresh page ---
const p1 = await browser.newPage(); await p1.route('**fonts.googleapis.com**',r=>r.abort());
await p1.goto(GAME_URL,{waitUntil:'domcontentloaded'}); await p1.waitForTimeout(400);
const runA = await p1.evaluate(recs=>recs.map(r=>window.CF.simulate(r)), RECORDS);
// --- run 2: same page, replayed in reverse order (proves no hidden state) ---
const runB = await p1.evaluate(recs=>[...recs].reverse().map(r=>window.CF.simulate(r)).reverse(), RECORDS);
await p1.close();
// --- run 3: brand new browser context (proves no page-lifetime state) ---
const p2 = await browser.newPage(); await p2.route('**fonts.googleapis.com**',r=>r.abort());
await p2.goto(GAME_URL,{waitUntil:'domcontentloaded'}); await p2.waitForTimeout(400);
const runC = await p2.evaluate(recs=>recs.map(r=>window.CF.simulate(r)), RECORDS);
await p2.close();

let mismatchAB=0, mismatchAC=0;
for(let i=0;i<RECORDS.length;i++){
  if(JSON.stringify(runA[i])!==JSON.stringify(runB[i])) mismatchAB++;
  if(JSON.stringify(runA[i])!==JSON.stringify(runC[i])) mismatchAC++;
}
log('records simulated      : '+RECORDS.length);
log('same page, reordered   : '+(RECORDS.length-mismatchAB)+'/'+RECORDS.length+' identical');
log('fresh page             : '+(RECORDS.length-mismatchAC)+'/'+RECORDS.length+' identical');
const outcomes={}; runA.forEach(r=>outcomes[r.outcome]=(outcomes[r.outcome]||0)+1);
log('outcome spread         : '+JSON.stringify(outcomes));
log('sample                 : '+JSON.stringify(runA[0]));

// --- fairness: the same kick index must give every player identical conditions ---
const p3 = await browser.newPage(); await p3.route('**fonts.googleapis.com**',r=>r.abort());
await p3.goto(GAME_URL,{waitUntil:'domcontentloaded'}); await p3.waitForTimeout(400);
const fair = await p3.evaluate(()=>{
  const a = window.CF.conditions(4242, 3);
  const b = window.CF.conditions(4242, 3);       // second player, same round
  const c = window.CF.conditions(4242, 4);       // next round
  return {a,b,c};
});
await p3.close();
log('round 3 player A wind  : '+JSON.stringify(fair.a));
log('round 3 player B wind  : '+JSON.stringify(fair.b)+'  -> '+(JSON.stringify(fair.a)===JSON.stringify(fair.b)?'IDENTICAL (fair)':'DIFFERENT (bug)'));
log('round 4 wind           : '+JSON.stringify(fair.c)+'  -> '+(JSON.stringify(fair.a)!==JSON.stringify(fair.c)?'differs (good)':'same (bug)'));
log(mismatchAB===0 && mismatchAC===0 ? '\nDETERMINISM PROOF: PASS' : '\nDETERMINISM PROOF: FAIL');
await browser.close();
