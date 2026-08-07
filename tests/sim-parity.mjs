/* Server/client simulation parity.
 *
 * The multiplayer anti-cheat rests on the server being able to re-run a
 * submitted input record and get exactly what the player's device got. This
 * test runs the same records through functions/_lib/sim.js (Node) and through
 * the game in a browser, and fails on any divergence.
 *
 *   node tests/sim-parity.mjs
 */
import { simulate as serverSim, validateRecord } from '../functions/_lib/sim.js';

const PW = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.js';
const GAME = process.env.GAME_URL || 'file://' + new URL('../game.html', import.meta.url).pathname;

/* a spread of records: every tier, both wall states, spots from 11m to 47m,
   curl in both directions, powers from a dink to a rocket, and elevation
   across its whole range — including left undefined, which must still
   reproduce the old power-coupled flight exactly */
function records(n){
  const out = [];
  const spots = [[0,11],[12,45],[-24,38],[33,34],[-6,32],[30,20],[-36,26],[2,16]];
  const tiers = ['junior','intermediate','senior','allireland'];
  for(let i=0;i<n;i++){
    const s = spots[i % spots.length];
    out.push({
      matchSeed: (1013904223 + i*2654435761) >>> 0,
      kickIndex: i % 9,
      power: 0.18 + ((i*17) % 78) / 100,
      aimM:  -3.2 + ((i*23) % 65) / 10,
      curl:  -0.9 + ((i*13) % 19) / 10,
      // every seventh record omits elevation, exercising the fallback
      elev:  (i % 7 === 0) ? undefined : ((i*29) % 101) / 100,
      x: s[0], z: s[1],
      wall: [0,0,3,4,2][i % 5],
      weather: i % 4,
      difficulty: tiers[i % 4],
    });
  }
  return out;
}

const RECS = records(120);

// --- validation gate ---
let badRejected = 0;
for(const bad of [
  {kickIndex:0, power:1.6, aimM:0}, {kickIndex:0, power:0.5, aimM:99},
  {kickIndex:-1, power:0.5, aimM:0}, {kickIndex:0, power:0.5, aimM:0, curl:4},
  {kickIndex:0, power:0.5, aimM:0, difficulty:'godmode'},
  {kickIndex:0, power:0.5, aimM:0, elev:1.4},
]) if(validateRecord(bad)) badRejected++;

const serverOut = RECS.map(serverSim);

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.route('**fonts.googleapis.com**', r=>r.abort());
await page.goto(GAME + '?debug=1', {waitUntil:'domcontentloaded'});
await page.waitForTimeout(400);
const clientOut = await page.evaluate(recs => recs.map(r => window.CF.simulate(r)), RECS);
await browser.close();

let mismatches = 0;
const firstFew = [];
for(let i=0;i<RECS.length;i++){
  const a = JSON.stringify(serverOut[i]), b = JSON.stringify(clientOut[i]);
  if(a !== b){
    mismatches++;
    if(firstFew.length < 3) firstFew.push({i, rec:RECS[i], server:serverOut[i], client:clientOut[i]});
  }
}
const spread = {};
serverOut.forEach(r => spread[r.outcome] = (spread[r.outcome]||0) + 1);

console.log('records            : ' + RECS.length);
console.log('outcome spread     : ' + JSON.stringify(spread));
console.log('bad records rejected: ' + badRejected + '/6');
console.log('server == client   : ' + (RECS.length - mismatches) + '/' + RECS.length);
for(const m of firstFew){
  console.log('  MISMATCH #' + m.i);
  console.log('    server ' + JSON.stringify(m.server));
  console.log('    client ' + JSON.stringify(m.client));
}
const pass = mismatches === 0 && badRejected === 6;
console.log(pass ? '\nSIM PARITY: PASS' : '\nSIM PARITY: FAIL');
process.exit(pass ? 0 : 1);
