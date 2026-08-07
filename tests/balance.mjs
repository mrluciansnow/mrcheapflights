/* A balance sweep, not a pass/fail gate — it prints the shape of the game so
 * a tuning change can be argued about with numbers. Run it after touching
 * anything in sim.js:
 *
 *   node tests/balance.mjs
 *
 * What to look for: no elevation band that returns nothing at every aim, a
 * tier ladder that descends, and a lean split where going against the keeper
 * scores better than going with him.
 */
import { simulate, DIFF } from '../functions/_lib/sim.js';

const N = 220;                            // seeds per cell
const tally = recs => {
  const t = {};
  for(const r of recs){ const o = simulate(r).outcome; t[o] = (t[o]||0)+1; }
  return t;
};
const rate = (t, keys) => keys.reduce((s,k)=>s+(t[k]||0),0) / N;

function cell(over){
  const recs = [];
  for(let i=0;i<N;i++) recs.push(Object.assign({
    matchSeed: (2654435761*i + 97) >>> 0, kickIndex: i % 11,
    x:0, z:11, wall:0, weather:0, difficulty:'senior',
    power:0.6, aimM:0, curl:0, elev:0.5,
  }, over));
  return tally(recs);
}

console.log('=== penalty, senior keeper: elevation vs aim (goal% / point% / miss%) ===');
console.log('elev\\aim      0.0m     1.6m     2.4m     2.9m     3.6m');
for(const elev of [0.10, 0.25, 0.40, 0.55, 0.70, 0.85, 1.00]){
  let row = String(elev.toFixed(2)).padEnd(9);
  for(const aimM of [0, 1.6, 2.4, 2.9, 3.6]){
    const t = cell({elev, aimM, power:0.62});
    const g = Math.round(rate(t, ['goal'])*100);
    const p = Math.round(rate(t, ['point','twopoint'])*100);
    row += (g + '/' + p).padStart(9);
  }
  console.log(row);
}

console.log('\n=== does power still matter, at a fixed low elevation? ===');
for(const power of [0.3, 0.5, 0.7, 0.9]){
  const t = cell({power, elev:0.2, aimM:2.6});
  console.log('  power ' + power.toFixed(1) + '  ' + JSON.stringify(t));
}

console.log('\n=== the lean: does going against the keeper pay? ===');
/* Split the same seeds by which way the keeper leaned, then compare scoring
   when the shot goes with his lean versus against it. If the lean is real,
   the two columns must differ. */
function leanSplit(aimM, elev){
  let withL = {n:0, g:0}, against = {n:0, g:0};
  for(let i=0;i<900;i++){
    const rec = {matchSeed:(48271*i+11)>>>0, kickIndex:i%11, x:0, z:11, wall:0,
                 weather:0, difficulty:'senior', power:0.62, curl:0, elev, aimM};
    // recover the lean by re-running the same seeded stream the sim uses
    const rng = mul(hash2(rec.matchSeed>>>0, rec.kickIndex|0));
    rng(); rng();                                   // wind
    rng();                                          // reaction
    const lean = -1 + rng()*2;                      // lean
    const out = simulate(rec).outcome;
    const bucket = (lean > 0) === (aimM > 0) ? withL : against;
    bucket.n++; if(out === 'goal') bucket.g++;
  }
  return {with: Math.round(withL.g/withL.n*100), against: Math.round(against.g/against.n*100)};
}
function mul(a){ return function(){ a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296; }; }
function hash2(a,b){ let h=Math.imul(a^0x9E3779B9,0x85EBCA6B)^Math.imul(b+0x165667B1,0xC2B2AE35);
  h^=h>>>15; return h>>>0; }
for(const [aimM, elev] of [[2.6,0.2],[2.9,0.3],[2.0,0.5]]){
  const r = leanSplit(aimM, elev);
  console.log('  aim ' + aimM + ' elev ' + elev +
              ' -> shot goes WITH his lean: ' + r.with + '% goals, AGAINST it: ' + r.against + '%');
}

console.log('\n=== every tier, best available corner ===');
for(const tier of Object.keys(DIFF)){
  let best = 0, at = null;
  for(const elev of [0.12,0.2,0.3,0.45])
    for(const aimM of [2.2,2.6,2.9,3.2])
      for(const power of [0.5,0.65,0.8]){
        const t = cell({difficulty:tier, elev, aimM, power});
        const g = rate(t,['goal']);
        if(g > best){ best = g; at = {elev, aimM, power}; }
      }
  console.log('  ' + tier.padEnd(13) + Math.round(best*100) + '% goals  at ' + JSON.stringify(at));
}
