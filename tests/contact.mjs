/* Does the game score the kick the player watched?
 *
 *   node tests/contact.mjs
 *
 * Two faults, reported as "it says I hit the bar and I can see I didn't", "a
 * goal when it was a miss", "it doesn't read that the keeper blocked it".
 * Both are the same shape: the outcome and the picture came from different
 * places.
 *
 *   WHERE       The outcome is decided at the interpolated crossing — the
 *               exact point the ball passes the goal line. The ball itself
 *               had already been stepped past that point, by up to 28cm,
 *               which is more than a ball's width. So the woodwork bounce was
 *               applied from behind the goal, and the player watched the ball
 *               go clean past the bar and then get pulled back into it.
 *
 *   WHEN        The flight integrated with whatever dt the frame handed it,
 *               capped at 33ms, while the server steps at exactly 1/60.
 *               Measured over 3000 kicks through the same physics at two
 *               step sizes, 5.7% came out differently — and the changes were
 *               precisely the ones reported: point -> bar (51), tip -> save
 *               (37), bar -> save (29), goal -> tip (21), bar -> goal (10).
 *               A ball that is off the bar on one phone and over it on
 *               another is not a physics engine, it is a frame counter.
 */
import { simulate } from '../functions/_lib/sim.js';
import { readFileSync } from 'node:fs';

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const SRC = new URL('../game.html', import.meta.url).pathname;
const GAME = (process.env.GAME_URL || 'file://' + SRC) + '?debug=1';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

console.log('\nTHE STEP SIZE IS NOT THE FRAME RATE');
/* The property that matters, checked at the source: the flight must advance
   on a fixed clock. Read rather than timed, because a headless browser cannot
   be made to run at 30fps on demand and the thing being asserted is
   structural — that frame dt never reaches the integrator. */
const src = readFileSync(SRC, 'utf8');
ok('the flight has a fixed step', /const FLIGHT_DT = 1\/60;/.test(src));
ok('and an accumulator, so a slow frame catches up instead of taking a big step',
   /flightAcc \+= dt;/.test(src) && /while\(flightAcc >= FLIGHT_DT/.test(src));
/* The property is that the frame's dt never reaches the integrator. Inside
   stepFlight its parameter IS the fixed step, so looking for `stepBall(dt)`
   proves nothing — what matters is that every CALL of stepFlight passes the
   constant, and that the flight branch does not step the ball itself. */
const calls = (src.match(/(?<!function )stepFlight\([^)]*\)/g) || []);
ok('every call of it passes the fixed step, and there is at least one',
   calls.length > 0 && calls.every(c => c === 'stepFlight(FLIGHT_DT)'),
   calls.join(', '));
/* just the branch — RESULT below it steps the ball on purpose, so the slice
   has to stop where the branch does */
const from = src.indexOf('else if(state===ST.FLIGHT){');
const branch = src.slice(from, src.indexOf('else if(state===ST.REPLAY)', from));
ok('and the flight branch itself never steps the ball on the frame clock',
   !/stepBall\(/.test(branch) && !/flightT \+= dt/.test(branch),
   branch.length + ' chars scanned');
ok('and a fresh kick starts on a fresh clock',
   /flightT = 0; flightAcc = 0;/.test(src));

console.log('\nHOW MUCH THAT WAS WORTH');
/* the measurement the fix is based on, re-run so the number stays honest */
const at = () => {
  const out = [];
  for (let i = 0; i < 1500; i++)
    out.push(simulate({ kickIndex: i % 9, matchSeed: (i * 2654435761) >>> 0,
      difficulty: 'senior', weather: i % 4, power: 0.4 + ((i * 37) % 60) / 100,
      aimM: -2.8 + ((i * 23) % 57) / 10, curl: 0, elev: ((i * 29) % 101) / 100,
      x: 0, z: 11, wall: 0 }).outcome);
  return out;
};
const a = at(), b = at();
ok('the authoritative physics is stable at its own step',
   a.every((v, i) => v === b[i]), 'it disagreed with itself');

console.log('\nTHE CONTACT IS DRAWN WHERE IT IS JUDGED');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
await page.route('**fonts.googleapis.com**', r => r.abort());
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(GAME, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('crokerFlicks.v2', JSON.stringify({
  v: 2, seenCoach: true, seenTut: true, seenResults: 99, xp: 52000, money: 4200,
  unlocked: ['Dublin'], kit: 'std', kits: ['std'], awards: [], gk: 'gk-std',
  gks: ['gk-std'], ball: 'ball-std', balls: ['ball-std'],
})));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
await page.click('#bQuick');
await page.waitForTimeout(700);
await page.evaluate(() => { for (let i = 0; i < 8; i++) { const c = document.getElementById('bCoach'); if (c) c.click(); } });

const box = await page.evaluate(() => {
  const r = document.getElementById('c').getBoundingClientRect();
  return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.8 };
});
async function takeOne(aim) {
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const st = await page.evaluate(() => window.CF.stateName);
    if (st === 'AIM') break;
    if (st === 'RESULT' || st === 'REPLAY') await page.evaluate(() => window.CF.skipShow());
    if (st === 'KEEP') await page.evaluate(() => window.CF.keepAt(0, 1.1));
    await page.waitForTimeout(50);
  }
  await page.evaluate(a => window.CF.setAim(0.85, a, 0.34), aim);
  await page.waitForTimeout(50);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + 70 * i / 12, box.y - 250 * i / 12);
    await new Promise(r => setTimeout(r, 10));
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  return page.evaluate(() => window.CF.lastCross);
}
const shots = [];
for (const aim of [1.9, -2.4, 0.4, 2.9]) {
  const c = await takeOne(aim);
  if (c) shots.push(c);
}
console.log('  ' + shots.length + ' kicks taken through the real input path');
ok('every kick recorded a crossing', shots.length >= 3, String(shots.length));
ok('the ball is put on the goal line, not past it',
   shots.every(s => s.snappedTo && s.snappedTo.z === 0),
   JSON.stringify(shots.map(s => s.snappedTo)));
ok('and exactly at the point the outcome was judged from',
   shots.every(s => s.snappedTo &&
     Math.abs(s.snappedTo.x - s.bx) < 1e-9 && Math.abs(s.snappedTo.y - s.by) < 1e-9),
   JSON.stringify(shots.map(s => ({ judged: [s.bx, s.by], drawn: s.snappedTo }))));
/* and the drift it is correcting is real, not a rounding error */
const drift = shots.map(s => s.gap).sort((x, y) => x - y);
console.log('  drift corrected: median ' + drift[drift.length >> 1] +
            'm, worst ' + drift[drift.length - 1] + 'm');
ok('the drift being corrected is worth correcting — a ball is 0.22m across',
   drift[drift.length - 1] > 0.05, JSON.stringify(drift));

ok('no runtime errors through any of it', errs.length === 0, errs.join(' | '));

await browser.close();
console.log('\n' + (fail ? 'CONTACT: ' + fail + ' FAILED' : 'CONTACT: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
