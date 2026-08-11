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

console.log('\nBOTH HERE, BOTH READY');
/* The ready gate is part of entering a match now: no kick opens until both
   have pressed it, so the first kick is never taken off somebody still
   reading the screen. The client does it through the same button a player
   would press. */
await until(A, () => !!window.CF.net.state.opponent, 20000, 'A sees an opponent');
const roomA = await st(A);
ok('each end is told who is over there', !!roomA.opponent, JSON.stringify(roomA.opponent));
ok('and that they are actually connected', roomA.opponent.here === true,
   JSON.stringify(roomA.opponent));
ok('no kick opens before both are ready', !roomA.live, JSON.stringify(roomA.live));
await A.evaluate(() => window.CF.net.ready());
await B.evaluate(() => window.CF.net.ready());

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

console.log('\nBOTH SIDES SEE THE SAME CLOCK');
/* Two people acting at once who are shown two different numbers do not
   believe either of them. */
const clocks = [await A.evaluate(() => document.getElementById('shotSecs').textContent),
                await B.evaluate(() => document.getElementById('keepSecs').textContent)];
ok('the striker is given a countdown', /\d/.test(clocks[0]), JSON.stringify(clocks[0]));
ok('and so is the keeper, which they never used to be', /\d/.test(clocks[1]),
   JSON.stringify(clocks[1]));
const secs = clocks.map(t => parseFloat(t));
/* Within a poll of each other, not to the millisecond. Each client's window
   opens when that client is shown the kick — which is the fix for a window
   that used to be mostly gone on arrival — and two measurements taken over
   two round trips cannot be simultaneous anyway. */
ok('and it is the same clock, not two of them', Math.abs(secs[0] - secs[1]) < 1.5,
   clocks.join(' / '));

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
ok('and A\'s own half is still out', a2.live?.submitted === false, JSON.stringify(a2.live));

/* The striker's half of the read. The ask was explicit: never show the kicker
   where the goalkeeper is going — only that they are moving, and roughly which
   way they are leaning. So a direction arrives, and nothing else does. */
console.log('\nWHAT THE STRIKER SEES OF THE KEEPER');
await until(A, () => !!window.CF.net.state.tell, 8000, 'A to notice the keeper move');
const aTell = (await st(A)).tell;
ok('the striker is told the keeper has moved', !!aTell, JSON.stringify(aTell));
ok('and given a lean, not a dive',
   aTell && [-1, 0, 1].includes(aTell.dir) &&
   aTell.x === undefined && aTell.y === undefined,
   JSON.stringify(aTell));
ok('nothing that reconstructs where they actually went',
   !JSON.stringify(aTell).includes('"x"') && !JSON.stringify(aTell).includes('"y"'),
   JSON.stringify(aTell));
ok('and the keeper on screen is leaning with it, not diving',
   await A.evaluate(() => {
     const k = window.CF.keeper;
     return !!k && k.committed !== true && typeof k.arm === 'number';
   }), 'the drawn keeper should signal, never commit');

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

console.log('\nTHE SECOND KICK IS A WHOLE KICK');
/* The server opens kick n+1 the instant kick n resolves, and both clients then
   spend several seconds watching kick n play out. A window measured from the
   server's stamp is therefore mostly gone before anybody is shown anything —
   and a replay that ran long left none of it, so the striker's clock hit zero
   on the first frame and rushed the shot while the keeper was recorded as
   standing up. Neither had touched the screen. */
await until(B, () => window.CF.net.state.phase === 'AIM' &&
                     window.CF.net.state.live?.kickIndex === 1, 25000, 'B on the ball for kick 1');
const secondClock = await B.evaluate(() => parseFloat(
  document.getElementById('shotSecs').textContent));
ok('the striker gets a real window on the second kick, not the dregs',
   secondClock > 3.5, secondClock + 's — the window is ' +
   (await B.evaluate(() => window.CF.net.state.live ? 'open' : 'gone')));
const aClock = await A.evaluate(() => parseFloat(
  document.getElementById('keepSecs').textContent));
ok('and the keeper is given the same one, not a stub',
   aClock > 3.5, aClock + 's');
/* The same LENGTH of window, opening within a poll or two of each other —
   which is the honest claim. Each client's window opens when that client
   finishes replaying the previous kick, and the resolved kick reaches the two
   of them a poll apart. What matters to a player is that they get a whole
   kick and are never submitted for; being able to compare screens to the
   millisecond is not something either of them can do. */
ok('and the two windows are the same length, give or take a poll',
   Math.abs(secondClock - aClock) < 2.5, secondClock + ' / ' + aClock);
ok('and nobody has been auto-submitted before touching anything',
   (await st(B)).live?.submitted === false && (await st(A)).live?.submitted === false,
   JSON.stringify([(await st(B)).live?.submitted, (await st(A)).live?.submitted]));

console.log('\nWHAT THE KEEPER SEES OF THE STRIKER');
/* The striker has to go FIRST: the kick resolves the instant the second half
   lands, so in the other order there is nothing left to read. */
await B.evaluate(() => {
  const ev = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  ev('ArrowLeft'); ev('ArrowUp'); ev(' ');
});
const gotRead = await until(A, () => window.CF.net.state.struck === true, 10000,
                            'A to notice the ball was struck');
const aRead = await st(A);
ok('the keeper is told the ball has gone', gotRead, JSON.stringify(aRead.tell));
ok('and given a direction, not a shot',
   aRead.tell && [-1, 0, 1].includes(aRead.tell.dir) &&
   aRead.tell.aimM === undefined && aRead.tell.power === undefined,
   JSON.stringify(aRead.tell));
ok('with the moment it happened, so acting on it is acting late',
   aRead.tell && typeof aRead.tell.at === 'number', JSON.stringify(aRead.tell));
ok('and nothing that would let the shot be reconstructed',
   !/curl|elev|"power"/.test(JSON.stringify(aRead.tell)), JSON.stringify(aRead.tell));
/* The read a keeper can actually use is the one that is there before the ball
   is: where this opponent has put their previous kicks. On kick 1 the only
   kick played is A's OWN, so there is nothing yet — and inventing a history
   out of your own kicks would be worse than having none. */
const tend = (await st(A)).tendency;
ok('a keeper is not handed a history built from their own kicks',
   tend === null, JSON.stringify(tend));

ok('the goal says so on screen rather than only in the transport',
   await A.evaluate(() => document.getElementById('keepLbl').textContent.includes('BALL AWAY')),
   await A.evaluate(() => document.getElementById('keepLbl').textContent));

// let A finish its half so the match settles
await A.evaluate(() => window.CF.keepAt(1.8, 1.0));
/* Both ends have to be waited on, not just one. They converge on the server's
   answer within a poll of each other, and reading the loser of that race a
   moment too early is the test's mistake, not the game's. */
await until(A, () => window.CF.net.state.state === 'settled', 40000, 'the match settles for A');
await until(B, () => window.CF.net.state.state === 'settled', 40000, 'the match settles for B');
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
