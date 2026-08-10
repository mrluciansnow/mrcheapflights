/* Two real browsers, one duel, one local server.
 *
 *   npx wrangler pages dev . --port 8788
 *   node tests/duel-client.mjs
 *
 * The API suite proves the server keeps its promises. This proves the client
 * transport in game.html actually speaks to it: that the seed and weather are
 * taken from the server rather than picked locally, that `srcStriker` and
 * `srcKeeper` flip to 'local'/'remote' from the same live kick, that a
 * resolved kick reaches BOTH clients with BOTH halves, and that neither is
 * shown the other's input before then.
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
  // a distinct device per client, or both pages are the same player
  await p.evaluate(t => localStorage.setItem('crokerFlicks.device',
    'd_' + t + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)), tag);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(400);
  // collect the resolved kicks the transport hands the game
  await p.evaluate(() => {
    window.__kicks = [];
    window.CF.net.on('Kick', k => window.__kicks.push(k));
  });
  return p;
}
const A = await client('a'), B = await client('b');
const st = p => p.evaluate(() => window.CF.net.state);

console.log('\nOPENING A DUEL');
const opened = await A.evaluate(() => window.CF.net.open({ kicks: 2, join: false }));
ok('A opens a duel from the browser', opened.state === 'waiting', JSON.stringify(opened));
ok('the seed came from the server', typeof opened.seed === 'number');
ok('so did the weather', Number.isInteger(opened.weather));
const seedA = await st(A);
ok('the client adopted the server seed rather than rolling its own',
   seedA.matchSeed === (opened.seed >>> 0) && seedA.seedFixed === true,
   JSON.stringify({ client: seedA.matchSeed, server: opened.seed >>> 0, fixed: seedA.seedFixed }));

const joined = await B.evaluate(id => window.CF.net.join(id), opened.matchId);
ok('B joins it', joined.matchId === opened.matchId && joined.state === 'in_progress',
   JSON.stringify(joined));
ok('both clients hold the same seed', joined.seed === opened.seed);
ok('and the same weather', joined.weather === opened.weather);

console.log('\nTHE SEAM');
await A.evaluate(() => window.CF.net.sync());
await B.evaluate(() => window.CF.net.sync());
const a1 = await st(A), b1 = await st(B);
ok('A is told it is striking', a1.live?.role === 'striker', JSON.stringify(a1.live));
ok('B is told it is keeping', b1.live?.role === 'keeper', JSON.stringify(b1.live));
ok('A wires itself striker-local, keeper-remote',
   a1.sources.striker === 'local' && a1.sources.keeper === 'remote', JSON.stringify(a1.sources));
ok('B wires itself the other way round',
   b1.sources.striker === 'remote' && b1.sources.keeper === 'local', JSON.stringify(b1.sources));
ok('both are given a clock', a1.left > 0 && b1.left > 0, a1.left + ' / ' + b1.left);

console.log('\nBLIND SUBMISSION');
await A.evaluate(() => window.CF.net.submit('strike',
  { power: 0.7, aimM: 2.4, curl: 0.2, elev: 0.4, x: 0, z: 11, wall: 0 }));
const a2 = await st(A);
ok('A knows its own half is in', a2.live?.submitted === true, JSON.stringify(a2.live));
await B.evaluate(() => window.CF.net.sync());
const b2 = await st(B);
ok('B is not told the strike arrived', b2.live?.submitted === false, JSON.stringify(b2.live));
ok('and cannot see it in anything the transport holds',
   !JSON.stringify(b2).includes('2.4'), JSON.stringify(b2).slice(0, 260));
ok('nothing has been handed to B to show yet',
   (await B.evaluate(() => window.__kicks.length)) === 0);

console.log('\nRESOLUTION REACHES BOTH');
await B.evaluate(() => window.CF.net.submit('dive', { x: -2.0, y: 1.0, at: 0.1 }));
await A.evaluate(() => window.CF.net.sync());
await B.evaluate(() => window.CF.net.sync());
const kicksA = await A.evaluate(() => window.__kicks);
const kicksB = await B.evaluate(() => window.__kicks);
ok('the resolved kick was handed to A', kicksA.length === 1, JSON.stringify(kicksA));
ok('and to B', kicksB.length === 1, JSON.stringify(kicksB));
const kA = kicksA[0] || {}, kB = kicksB[0] || {};
ok('both were given the striker\'s swipe', kA.strike?.aimM === 2.4 && kB.strike?.aimM === 2.4,
   JSON.stringify([kA.strike, kB.strike]));
ok('both were given the keeper\'s dive', kA.dive?.x === -2 && kB.dive?.x === -2,
   JSON.stringify([kA.dive, kB.dive]));
ok('both were told the same outcome', kA.outcome === kB.outcome && !!kA.outcome,
   kA.outcome + ' / ' + kB.outcome);

console.log('\nREPLAY AGREES');
/* The point of shipping both halves: each client replays the kick through its
   own physics and must land on the server's outcome. If this ever disagrees,
   the two players are watching different matches. */
const replay = p => p.evaluate(k => window.CF.simulate({
  ...k.strike, kickIndex: k.kickIndex, dive: k.dive,
}).outcome, kA);
const rA = await replay(A), rB = await replay(B);
ok('A replays the server\'s outcome', rA === kA.outcome, rA + ' vs ' + kA.outcome);
ok('B replays the same one', rB === kA.outcome, rB + ' vs ' + kA.outcome);

console.log('\nSIDES SWAP');
const a3 = await st(A), b3 = await st(B);
ok('kick 1 puts A in goal', a3.live?.role === 'keeper' && a3.sources.keeper === 'local',
   JSON.stringify([a3.live, a3.sources]));
ok('and B on the ball', b3.live?.role === 'striker' && b3.sources.striker === 'local',
   JSON.stringify([b3.live, b3.sources]));

console.log('\nTHE DUEL ENDS');
await A.evaluate(() => window.CF.net.submit('dive', null));
await B.evaluate(() => window.CF.net.submit('strike',
  { power: 0.6, aimM: -2.2, curl: -0.3, elev: 0.3, x: 0, z: 11, wall: 0 }));
await A.evaluate(() => window.CF.net.sync());
const fin = await st(A);
ok('the match settles', fin.state === 'settled', JSON.stringify(fin));
ok('both kicks were shown to A', (await A.evaluate(() => window.__kicks.length)) === 2);
ok('polling stopped when it ended', fin.live === null, JSON.stringify(fin.live));

await browser.close();
console.log('\n' + (fail ? 'DUEL CLIENT: ' + fail + ' FAILED' : 'DUEL CLIENT: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
