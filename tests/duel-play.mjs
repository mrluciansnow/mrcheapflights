/* Two browsers playing a real online match through the game loop.
 *
 *   npx wrangler pages dev . --port 8788
 *   node tests/duel-play.mjs
 *
 * The transport test proves the wire works. This proves the GAME does: that
 * both ends are live inside the same kick at the same time, that one is on
 * the ball while the other is in goal, that the keeper is not handed a
 * telegraph of a human's shot, that both watch the identical resolved kick,
 * and that the scoreline the two of them end on is the same scoreline.
 */
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const BASE = process.env.MP_BASE || 'http://localhost:8788';
const GAME = BASE + '/game.html?debug=1';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function client(tag) {
  const p = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await p.route('**fonts.googleapis.com**', r => r.abort());
  await p.goto(GAME, { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => {
    localStorage.setItem('crokerFlicks.device',
      'd_' + t + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('crokerFlicks.v2', JSON.stringify({
      v: 2, seenCoach: true, xp: 20000, money: 9000, unlocked: ['Dublin'],
      kit: 'std', kits: ['std'], awards: [], gk: 'gk-std', gks: ['gk-std'],
      ball: 'ball-std', balls: ['ball-std'],
    }));
  }, tag);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  await p.evaluate(() => { window.__err = []; });
  p.on('pageerror', e => console.log('  !! page error: ' + e.message));
  return p;
}
const A = await client('a'), B = await client('b');
const st = p => p.evaluate(() => window.CF.net.state);
// wait for a condition on one client, on its own clock
async function until(p, fn, ms = 20000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await p.evaluate(fn)) return true;
    await p.waitForTimeout(120);
  }
  console.log('  ..  timed out waiting for ' + label + ': ' +
              JSON.stringify(await st(p)).slice(0, 220));
  return false;
}

console.log('\nBOTH ENDS ENTER THE SAME MATCH');
const opened = await A.evaluate(() => window.CF.net.play({ kicks: 2, join: false }));
ok('A starts an online match', !!opened && opened.state === 'waiting', JSON.stringify(opened));
const joined = await B.evaluate(id => window.CF.net.play({ matchId: id }), opened.matchId);
ok('B joins it', joined.matchId === opened.matchId, JSON.stringify(joined));
ok('both are in online mode',
   (await st(A)).mode === 'online' && (await st(B)).mode === 'online');

console.log('\nSIMULTANEOUS — one kick, two ends, both live');
await until(A, () => window.CF.net.state.phase === 'AIM', 20000, 'A on the ball');
await until(B, () => window.CF.net.state.phase === 'KEEP', 20000, 'B in goal');
const a1 = await st(A), b1 = await st(B);
ok('A is on the ball', a1.phase === 'AIM', JSON.stringify(a1));
ok('B is in goal at the same moment', b1.phase === 'KEEP', JSON.stringify(b1));
ok('they are inside the same kick', a1.live?.kickIndex === b1.live?.kickIndex,
   a1.live?.kickIndex + ' / ' + b1.live?.kickIndex);
ok('neither is waiting on the other to finish first',
   a1.phase !== 'NET_WAIT' && b1.phase !== 'NET_WAIT');
ok('both clocks run from the same instant', a1.live?.openedAt === b1.live?.openedAt,
   a1.live?.openedAt + ' / ' + b1.live?.openedAt);

console.log('\nTHE KEEPER IS NOT SHOWN A HUMAN\'S SHOT');
const tell = await B.evaluate(() => window.CF.telegraph);
ok('there is no telegraph to read online', tell === null, JSON.stringify(tell));
ok('and nothing about the strike has reached B',
   !JSON.stringify(b1).includes('aimM'), JSON.stringify(b1).slice(0, 200));

console.log('\nBOTH PLAY THEIR HALF');
// B throws himself first, while A is still lining it up — which is the point
await B.evaluate(() => window.CF.keepAt(-2.2, 0.95));
await until(B, () => window.CF.net.state.phase === 'NET_WAIT', 10000, 'B leaves the goal');
ok('B stops keeping the moment the dive is thrown, without waiting on the wire',
   (await st(B)).phase === 'NET_WAIT');
// and the server confirms it a round trip later
await until(B, () => window.CF.net.state.live?.submitted === true, 10000, 'B confirmed');
const b2 = await st(B);
ok('B\'s dive is confirmed in on the shared clock', b2.live?.submitted === true,
   JSON.stringify(b2.live));
ok('and it was stamped after the kick opened', b2.kickT > 0, String(b2.kickT));

const a2 = await st(A);
ok('A is still on the ball, untouched by any of that', a2.phase === 'AIM', JSON.stringify(a2));
ok('A was not told the keeper had gone', a2.live?.submitted === false, JSON.stringify(a2.live));

await A.evaluate(() => {
  // drive the striker's half the way the keyboard does
  const ev = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  ev('ArrowRight'); ev('ArrowRight'); ev('ArrowUp'); ev(' ');
});

console.log('\nONE RESOLUTION, TWO SCREENS');
await until(A, () => window.CF.net.state.played >= 1, 25000, 'A sees the kick resolved');
await until(B, () => window.CF.net.state.played >= 1, 25000, 'B sees the kick resolved');
const pA = await A.evaluate(() => window.CF.net.state);
const pB = await B.evaluate(() => window.CF.net.state);
ok('the kick resolved for A', pA.played >= 1, JSON.stringify(pA.score));
ok('and for B', pB.played >= 1, JSON.stringify(pB.score));
ok('both ends hold the same scoreline',
   pA.score.you === pB.score.them && pA.score.them === pB.score.you,
   JSON.stringify([pA.score, pB.score]));

console.log('\nSIDES SWAP AND THE MATCH RUNS OUT');
await until(A, () => ['KEEP', 'NET_WAIT', 'OVER'].includes(window.CF.net.state.phase),
            25000, 'A moves on');
const a3 = await st(A), b3 = await st(B);
ok('A did not stay on the ball for a second kick in a row',
   a3.phase !== 'AIM' || a3.live?.role === 'striker' && a3.live?.kickIndex === 1 === false,
   JSON.stringify(a3.live));
ok('kick 1 belongs to the other striker',
   !a3.live || a3.live.role === 'keeper', JSON.stringify(a3.live));
ok('and B has the ball for it', !b3.live || b3.live.role === 'striker', JSON.stringify(b3.live));

// play it out so the match settles
await B.evaluate(() => {
  const ev = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  ev('ArrowLeft'); ev('ArrowUp'); ev(' ');
});
await until(A, () => window.CF.net.state.state === 'settled', 40000, 'the match settles');
const fA = await st(A), fB = await st(B);
ok('the match settled', fA.state === 'settled', JSON.stringify(fA.state));
ok('both agree on the final score',
   fA.score.you === fB.score.them && fA.score.them === fB.score.you,
   JSON.stringify([fA.score, fB.score]));
ok('both played every kick', fA.played === 2 && fB.played === 2,
   fA.played + ' / ' + fB.played);

const errs = await A.evaluate(() => (window.__err || []).length);
ok('no runtime errors on the way through', errs === 0);

await browser.close();
console.log('\n' + (fail ? 'DUEL PLAY: ' + fail + ' FAILED' : 'DUEL PLAY: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
