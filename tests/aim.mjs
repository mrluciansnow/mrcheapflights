/* The aiming aids, and whether they tell the truth.
 *
 *   node tests/aim.mjs
 *
 * The player has one instrument: a reticle that lights the part of the goal
 * the ball is heading for. Everything they learn about the shot, they learn
 * from it. So the only question that matters about it is whether it agrees
 * with what the ball then does — and it did not.
 *
 * The aid asked "is it in the goal?" as `centre height < crossbar height`,
 * both treated as points. The game does not score it that way: a ball whose
 * centre passes within a ball-and-a-post of the frame hits the frame. That is
 * a band 39cm tall under the bar and 19.5cm inside each post where the
 * reticle lit up yellow, said GOAL, and the ball came back off the woodwork —
 * measured at 100% of 2000 kicks, with only ±4cm of contact scatter to lift
 * it clear. There was no way for a player to learn that, because the one
 * instrument they had was telling them the opposite.
 *
 * So: the aid must name the woodwork where the woodwork is what happens, and
 * must not cry wolf anywhere else. Both directions are checked, because an
 * aid that warns everywhere is exactly as useless as one that never warns.
 */
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const GAME = (process.env.GAME_URL ||
  'file://' + new URL('../game.html', import.meta.url).pathname) + '?debug=1';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
await page.route('**fonts.googleapis.com**', r => r.abort());
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(GAME, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('crokerFlicks.v2', JSON.stringify({
  v: 2, seenCoach: true, seenTut: true, xp: 52000, money: 4200, unlocked: ['Dublin'],
  kit: 'std', kits: ['std'], awards: [], gk: 'gk-std', gks: ['gk-std'],
  ball: 'ball-std', balls: ['ball-std'],
})));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
await page.click('#bQuick');
await page.waitForTimeout(900);
await page.evaluate(() => { for (let i = 0; i < 8; i++) { const c = document.getElementById('bCoach'); if (c) c.click(); } });
/* five seconds is not long enough to walk a control surface */
await page.evaluate(() => window.CF.holdClock(true));
await page.waitForTimeout(400);

console.log('\nTHE AID AND THE BALL AGREE');
/* Walk the elevation control one point at a time. At each step ask the aid
   what it is promising and the simulation what actually lands, and compare.
   Every disagreement is a lie the player cannot catch. */
const walk = await page.evaluate(() => {
  /* the match is played in whatever weather it rolled, and a wet ball leaves
     the boot 7% slower — comparing against a dry twin puts the whole curve
     out by more than the bar is tall */
  const w = window.CF.aimVerdict.weather;
  const out = [];
  for (let e = 25; e <= 75; e++) {
    window.CF.setAim(0.78, 0, e / 100);
    const v = window.CF.aimVerdict;
    // what really happens, same inputs, keeper deliberately out of the way
    const seen = {};
    for (let i = 0; i < 40; i++) {
      const r = window.CF.simulate({ power: 0.78, aimM: 0, elev: e / 100, curl: 0,
        matchSeed: 55000 + i, kickIndex: i % 9, difficulty: 'senior', weather: w,
        x: 0, z: 11, dive: { x: -4.9, y: 0.2, at: -2 } });
      seen[r.outcome] = (seen[r.outcome] || 0) + 1;
    }
    const real = Object.entries(seen).sort((a, b) => b[1] - a[1])[0];
    out.push({ e: e / 100, says: v.frame ? v.frame : v.over ? 'point' : 'goal',
               real: real[0], share: real[1] / 40, y: v.y });
  }
  return out;
});
const barCells = walk.filter(r => r.real === 'bar');
const warned = barCells.filter(r => r.says === 'bar');
console.log('  ' + barCells.length + ' elevations off the crossbar; the aid names ' +
            warned.length + ' of them');
/* Not every cell: these flights carry their own wind and the aid carries the
   match's, so at the two cells on the very edge of the band they land a
   centimetre either side of it. The exact form of this check is below. */
ok('the aid warns across the elevations that hit the bar',
   barCells.length > 0 && warned.length >= barCells.length - 2,
   barCells.filter(r => r.says !== 'bar').map(r => r.e + ' said ' + r.says).join(', '));

const criedWolf = walk.filter(r => r.says === 'bar' && r.real !== 'bar' && r.share > 0.9);
ok('and does not cry wolf where the ball goes clean through',
   criedWolf.length <= 2, criedWolf.map(r => r.e + ' warned, really ' + r.real).join(', '));

/* the band has to be a band, not the whole control */
const warnedSpan = walk.filter(r => r.says === 'bar');
ok('the warning is a band, not the whole elevation control',
   warnedSpan.length > 3 && warnedSpan.length < 20, warnedSpan.length + ' of 51 steps');
ok('with a clean goal below it',
   walk.find(r => r.e === warnedSpan[0].e - 0.01).says === 'goal',
   JSON.stringify(walk.find(r => r.e === warnedSpan[0].e - 0.01)));
ok('and a clean point above it',
   walk.find(r => r.e === warnedSpan[warnedSpan.length - 1].e + 0.01).says === 'point',
   JSON.stringify(walk.find(r => r.e === warnedSpan[warnedSpan.length - 1].e + 0.01)));

console.log('\nTHE AID AND THE SCORER USE THE SAME GEOMETRY');
/* The walk above compares the aid against separately-seeded flights, which
 * share an elevation but not a wind, so laterally they can never quite agree.
 * This is the exact form of the same question: take flights that DID happen,
 * with whatever wind they had, and ask the aid to judge the point the ball
 * actually arrived at. Every disagreement here is a real one.
 *
 * This is the contract. `frameHit` and `evaluateAtPlane` are two descriptions
 * of one piece of ironwork, and they have to be the same description. */
const agree = await page.evaluate(() => {
  let n = 0, wrong = [];
  for (let i = 0; i < 2500; i++) {
    const r = window.CF.simulate({
      power: 0.4 + (i % 60) / 100, aimM: -3.6 + (i % 73) / 10,
      elev: (i % 101) / 100, curl: 0, matchSeed: 77000 + i, kickIndex: i % 9,
      difficulty: 'senior', weather: i % 4, x: 0, z: 11,
      dive: { x: -4.9, y: 0.2, at: -2 },        // keeper deliberately elsewhere
    });
    if (r.hitX === null) continue;               // never reached the line
    /* judged at the CROSSING point — r.x/r.y is one step past the plane */
    const said = window.CF.frameAt(r.hitX, r.hitY);
    const real = r.outcome === 'bar' || r.outcome === 'post' ? r.outcome : null;
    n++;
    if (said !== real && wrong.length < 6)
      wrong.push({ x: +r.hitX.toFixed(3), y: +r.hitY.toFixed(3), said, real, out: r.outcome });
  }
  return { n, wrong };
});
console.log('  ' + agree.n + ' flights judged');
ok('the aid calls the woodwork exactly where the game scores it',
   agree.wrong.length === 0, JSON.stringify(agree.wrong));

console.log('\nTHE POSTS TOO');
const posts = await page.evaluate(() => {
  const out = [];
  for (let a = 250; a <= 340; a += 5) {
    window.CF.setAim(0.78, a / 100, 0.30);
    const v = window.CF.aimVerdict;
    out.push({ a: a / 100, x: v.x, says: v.frame || (v.inPosts ? 'in' : 'wide') });
  }
  return out;
});
ok('a ball heading inside the post reads as on target',
   posts.filter(r => Math.abs(r.x) < 3.05).every(r => r.says === 'in'),
   JSON.stringify(posts.filter(r => Math.abs(r.x) < 3.05 && r.says !== 'in')));
ok('one heading at the post says so',
   posts.filter(r => Math.abs(Math.abs(r.x) - 3.25) <= 0.19).every(r => r.says === 'post'),
   JSON.stringify(posts.filter(r => Math.abs(Math.abs(r.x) - 3.25) <= 0.19 && r.says !== 'post')));
ok('and one heading well outside it still reads as wide',
   posts.filter(r => Math.abs(r.x) > 3.5).every(r => r.says === 'wide'),
   JSON.stringify(posts.filter(r => Math.abs(r.x) > 3.5 && r.says !== 'wide')));

console.log('\nBOTH POSTS, WHATEVER THE WIND');
/* Aiming at a fixed number and expecting a post is a test that passes on a
 * calm day and fails on a windy one — the drifted flight is the one being
 * judged, and this match's wind is whatever it rolled. So: sweep, and require
 * that each post can be found. */
const sides = await page.evaluate(() => {
  let left = null, right = null;
  for (let a = -400; a <= 400; a += 2) {
    window.CF.setAim(0.78, a / 100, 0.30);
    const v = window.CF.aimVerdict;
    if (v.frame === 'post') { if (v.x < 0 && left === null) left = v.x;
                              if (v.x > 0 && right === null) right = v.x; }
  }
  return { left, right };
});
ok('a shot heading at the near post warns', sides.left !== null, JSON.stringify(sides));
ok('and so does one at the far post', sides.right !== null, JSON.stringify(sides));

console.log('\nNOTHING ELSE MOVED');
ok('the swipe still produces the shot it always did', await page.evaluate(() => {
  window.CF.setAim(0.62, 1.2, 0.45, 0.3);
  const a = window.CF.aimState;
  return Math.abs(a.power - 0.62) < 1e-9 && Math.abs(a.aimM - 1.2) < 1e-9 &&
         Math.abs(a.elev - 0.45) < 1e-9 && Math.abs(a.curl - 0.3) < 1e-9;
}));
ok('no runtime errors through any of it', errs.length === 0, errs.join(' | '));

await browser.close();
console.log('\n' + (fail ? 'AIM: ' + fail + ' FAILED' : 'AIM: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
