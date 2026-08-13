/* The two things the flight is supposed to have a decision in.
 *
 *   node tests/physics.mjs
 *
 * Pure sim.js, no browser, so it runs at thousands of kicks a cell instead of
 * the fourteen tests/keeper.mjs can afford. That matters: fourteen samples
 * cannot tell a real fifteen-point move from noise, and this suite exists
 * because a change was once read off exactly that and got the sign wrong.
 *
 *   WHEN TO GO    A dive used to arrive at full stretch and hold the pose
 *                 until the ball turned up, so every dive thrown between 0.6s
 *                 before the strike and the strike itself saved at IDENTICAL
 *                 rates. There was no decision — you went as early as the
 *                 window allowed, every time. The curve has to have a peak in
 *                 the middle now, and it has to be worth hitting.
 *
 *   THE WIND      A flat lateral acceleration is a fixed offset you learn
 *                 once from the arrow and then apply forever, and distance
 *                 only buys more of the same drift. A gust has to bite harder
 *                 the longer the ball is up — and stay out of the way at 11m,
 *                 because the shootout's balance is measured and settled.
 *
 * Plus a fence around the shootout itself, since both changes are on the
 * outcome path and the easiest way to break a balanced game is by accident.
 */
import { simulate, mulberry32 } from '../functions/_lib/sim.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

/* ---------------- when to go ---------------- */
const SPOT = { '-1': -2.2, '0': 0, '1': 2.2 };
function sweep(at, knows, n = 8000) {
  let saved = 0;
  const rnd = mulberry32(9090);
  for (let i = 0; i < n; i++) {
    const aim = [-2.4, -1.2, 0, 1.2, 2.4][(rnd() * 5) | 0];
    const el = 0.15 + rnd() * 0.45;
    const truth = aim < -0.9 ? -1 : aim > 0.9 ? 1 : 0;
    const dir = knows ? truth : [-1, 0, 1][(rnd() * 3) | 0];
    const r = simulate({ kickIndex: i, matchSeed: 8080, difficulty: 'senior',
      weather: 0, power: 0.78, aimM: aim, curl: 0, elev: el, x: 0, z: 11,
      wall: 0, dive: { x: SPOT[dir], y: 1.1, at } });
    if (r.outcome === 'save' || r.outcome === 'tip') saved++;
  }
  return +(saved / n * 100).toFixed(1);
}

console.log('\nWHEN TO GO — the dive is a decision, not a formality');
const ATS = [-0.60, -0.45, -0.30, -0.15, 0, 0.10, 0.18, 0.26];
const blind = {}, shown = {};
console.log('     at    blind   shown');
for (const at of ATS) {
  blind[at] = sweep(at, false);
  shown[at] = sweep(at, true);
  console.log('  ' + String(at).padStart(6) + String(blind[at]).padStart(8) +
              String(shown[at]).padStart(8));
}
const bestAt = ATS.reduce((a, b) => blind[b] > blind[a] ? b : a);

ok('going as early as the window allows is no longer the answer',
   bestAt !== ATS[0], 'best blind timing was ' + bestAt);
ok('the best moment is somewhere in the middle of the window',
   bestAt !== ATS[0] && bestAt !== ATS[ATS.length - 1], 'best was ' + bestAt);
ok('committing far too early has a real price — a third of the saves or worse',
   blind[-0.60] < blind[bestAt] * 0.7,
   blind[-0.60] + '% vs ' + blind[bestAt] + '% at the peak');
ok('and so does leaving it too late',
   blind[0.26] < blind[bestAt] * 0.9,
   blind[0.26] + '% vs ' + blind[bestAt] + '% at the peak');
/* Two neighbouring cells being identical to a tenth of a point over 8000
   samples is the exact signature of the bug this replaced: the value simply
   was not being read. */
const flat = ATS.slice(0, 5).every(a => blind[a] === blind[ATS[0]]);
ok('the early half of the window is not one flat plateau', !flat,
   JSON.stringify(blind));
ok('reading the shot still pays at the best moment',
   shown[bestAt] > blind[bestAt] * 1.8,
   'blind ' + blind[bestAt] + '% vs shown ' + shown[bestAt] + '%');
ok('and a keeper who reads it still does not keep everything out',
   shown[bestAt] < 70, shown[bestAt] + '%');

/* ---------------- the wind ---------------- */
console.log('\nTHE WIND — a gust, and one that grows with the flight');
/* Two separate claims, and they need two separate checks.
 *
 * The first is that drift grows with range at all. That one is measured, but
 * be honest about what it proves: a FLAT wind would pass it too, because a
 * constant push acting for twice as long moves the ball further either way.
 * It is a fence against somebody zeroing the wind, not evidence of a gust. */
function windPull(z, n = 4000) {
  const rnd = mulberry32(31337);
  const d = [];
  for (let i = 0; i < n; i++) {
    d.push(simulate({ kickIndex: i, matchSeed: 2024, difficulty: 'senior',
      weather: 0, power: 0.55 + rnd() * 0.4, aimM: -1.5 + rnd() * 3, curl: 0,
      elev: 0.25 + rnd() * 0.45, x: 0, z, wall: 0,
      dive: { x: 0, y: 1.1, at: 5 } }).x);
  }
  d.sort((a, b) => a - b);
  const q = f => d[Math.floor(d.length * f)];
  return +((q(0.9) - q(0.1)) / 2).toFixed(3);       // half the 10-90 spread
}
const pull = {};
for (const z of [11, 20, 32, 45]) {
  pull[z] = windPull(z);
  console.log('  ' + String(z).padStart(3) + 'm   spread ±' + pull[z] + 'm');
}
ok('a long ball is pushed around far more than a short one',
   pull[45] > pull[11] * 2.5, JSON.stringify(pull));
ok('and it grows the whole way out, not in one step',
   pull[20] > pull[11] && pull[32] > pull[20] && pull[45] > pull[32],
   JSON.stringify(pull));
ok('an 11m penalty is still a placement, not a lottery',
   pull[11] < 1.6, pull[11] + 'm');

/* The second claim is that the wind BREATHES, and no aggregate over random
 * kicks separates that from a flat push — the two produce the same shape of
 * spread. What does separate them is the gust term itself, so that is what is
 * checked, in both copies of the physics at once.
 *
 * Which is the failure that actually costs something. The client and the
 * server each carry their own copy of the flight, and a change landing in one
 * and not the other does not look like a bug: solo play is fine, online play
 * is fine, and then one kick in a few hundred is scored differently by the
 * server than by the screen the player watched it on. sim-parity would catch
 * it — this says WHICH line moved. */
const { readFileSync } = await import('node:fs');
const here = f => readFileSync(new URL(f, import.meta.url).pathname, 'utf8');
const GUST = /const gust = t => 1 \+ 0\.35\*dsin\(t\*4\.4 \+ wind\*17\.3\);/;
const inSim = GUST.test(here('../functions/_lib/sim.js'));
const inGame = GUST.test(here('../game.html'));
ok('the wind is a function of flight time, not a constant', inSim && inGame,
   'sim.js: ' + inSim + ', game.html: ' + inGame);
/* and the settle, for the same reason — it is the other half of this change */
const SETTLE = /clamp\(\(dt - dur - HANG\) \/ FALL, 0, 1\)/;
ok('and the keeper comes down in both copies too',
   SETTLE.test(here('../functions/_lib/sim.js')) && SETTLE.test(here('../game.html')));

/* ---------------- the fence ---------------- */
console.log('\nTHE SHOOTOUT IS WHERE IT WAS');
/* Both changes are on the outcome path, and the easiest way to break a
   balanced game is by accident. 76.6 points per hundred kicks is where the
   shootout has sat through the last several passes; this is the fence around
   it, not a target to tune to. */
const spread = {};
const rnd = mulberry32(555);
let kicks = 0;
for (let i = 0; i < 20000; i++) {
  const r = simulate({ kickIndex: i, matchSeed: 7171,
    difficulty: ['junior', 'intermediate', 'senior', 'allireland'][(rnd() * 4) | 0],
    weather: (rnd() * 4) | 0, power: 0.35 + rnd() * 0.6, aimM: -2.6 + rnd() * 5.2,
    curl: -0.6 + rnd() * 1.2, elev: rnd(), x: 0, z: 11, wall: 0 });
  spread[r.outcome] = (spread[r.outcome] || 0) + 1;
  kicks++;
}
const perKick = (spread.goal * 3 + (spread.twopoint || 0) * 2 + spread.point) / kicks;
console.log('  ' + JSON.stringify(spread));
console.log('  score per kick: ' + perKick.toFixed(4));
ok('the solo shootout still scores where it always has',
   Math.abs(perKick - 0.766) < 0.03, perKick.toFixed(4) + ' (want 0.766 ± 0.03)');
ok('the keeper still saves about a third of them',
   spread.save / kicks > 0.28 && spread.save / kicks < 0.38,
   (spread.save / kicks * 100).toFixed(1) + '%');
ok('and a goal is still worth going for',
   spread.goal / kicks > 0.12, (spread.goal / kicks * 100).toFixed(1) + '%');

console.log('\n' + (fail ? 'PHYSICS: ' + fail + ' FAILED' : 'PHYSICS: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
