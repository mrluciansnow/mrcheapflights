/* The ONLINE button, driven the way a player drives it.
 *
 *   npx wrangler pages dev . --port 8788
 *   node tests/duel-lobby.mjs
 *
 * The other suites prove the wire and the loop. This proves the thing a
 * person actually touches: press ONLINE, host a game, read the code off the
 * screen, have somebody type it in, and end up in a match — with no debug
 * console anywhere in the story.
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
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.__errs = errs;
  return p;
}
async function until(p, fn, ms = 20000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await p.evaluate(fn)) return true;
    await p.waitForTimeout(150);
  }
  console.log('  ..  timed out waiting for ' + label);
  return false;
}
const st = p => p.evaluate(() => window.CF.net.state);
const shown = (p, id) => p.evaluate(i => {
  const el = document.getElementById(i);
  return !!el && !el.classList.contains('hidden');
}, id);

const A = await client('a'), B = await client('b');

console.log('\nTHE BUTTON OPENS A LOBBY');
await A.click('#bOnline');
await A.waitForTimeout(300);
ok('ONLINE opens the lobby', await shown(A, 'ovOnline'));
ok('and offers the three ways in',
   await shown(A, 'mpPick') &&
   await A.evaluate(() => !!document.getElementById('bFindGame')) &&
   await A.evaluate(() => !!document.getElementById('bHostGame')) &&
   await A.evaluate(() => !!document.getElementById('bJoinGame')));

console.log('\nHOSTING SHOWS A CODE');
await A.click('#bHostGame');
await until(A, () => !document.getElementById('mpCodeWrap').classList.contains('hidden'),
            15000, 'the code to appear');
const code = (await A.evaluate(() => document.getElementById('mpCode').textContent) || '').trim();
ok('a code is shown to read out', code.length > 0, JSON.stringify(code));
ok('the lobby says what it is waiting for',
   /waiting/i.test(await A.evaluate(() => document.getElementById('mpMsg').textContent)),
   await A.evaluate(() => document.getElementById('mpMsg').textContent));
ok('the host is in an online match already',
   (await st(A)).state === 'waiting', JSON.stringify((await st(A)).state));

console.log('\nTYPING THE CODE GETS YOU IN');
await B.click('#bOnline');
await B.waitForTimeout(250);
await B.click('#bJoinGame');
await B.waitForTimeout(250);
ok('the code box appears', await shown(B, 'mpJoinCode'));
await B.fill('#mpJoinCode', code);
await B.click('#bJoinGo');
ok('B is in the match', await until(B, () => window.CF.net.state.state === 'in_progress',
   20000, 'B to join'), JSON.stringify((await st(B)).state));
ok('and the host is told, without touching anything',
   await until(A, () => window.CF.net.state.state === 'in_progress', 20000, 'A to notice'),
   JSON.stringify((await st(A)).state));

console.log('\nTHE LOBBY GETS OUT OF THE WAY');
ok('the overlay closes for the host', await until(A, () =>
   document.getElementById('ovOnline').classList.contains('hidden'), 8000, 'A overlay to close'));
ok('and for the joiner', await until(B, () =>
   document.getElementById('ovOnline').classList.contains('hidden'), 8000, 'B overlay to close'));

console.log('\nAND THEY ARE BOTH IN THE SAME KICK');
await until(A, () => ['AIM', 'KEEP'].includes(window.CF.net.state.phase), 20000, 'A into the kick');
await until(B, () => ['AIM', 'KEEP'].includes(window.CF.net.state.phase), 20000, 'B into the kick');
const a1 = await st(A), b1 = await st(B);
ok('one is on the ball and the other in goal',
   (a1.phase === 'AIM' && b1.phase === 'KEEP') || (a1.phase === 'KEEP' && b1.phase === 'AIM'),
   a1.phase + ' / ' + b1.phase);
ok('inside the same kick', a1.live?.kickIndex === b1.live?.kickIndex);
ok('on the same clock', a1.live?.openedAt === b1.live?.openedAt);

console.log('\nA BAD CODE IS SURVIVABLE');
const C = await client('c');
await C.click('#bOnline');
await C.waitForTimeout(250);
await C.click('#bJoinGame');
await C.waitForTimeout(200);
await C.fill('#mpJoinCode', 'NOSUCHGAME');
await C.click('#bJoinGo');
await C.waitForTimeout(2500);
const msg = await C.evaluate(() => document.getElementById('mpMsg').textContent);
ok('a wrong code says so rather than hanging', /not open|no such|cannot|could not/i.test(msg), msg);
ok('and the choices come back so you can try again', await shown(C, 'mpPick'));

const errs = [...A.__errs, ...B.__errs, ...C.__errs];
ok('no runtime errors anywhere in the flow', errs.length === 0, errs.join(' | '));

await browser.close();
console.log('\n' + (fail ? 'DUEL LOBBY: ' + fail + ' FAILED' : 'DUEL LOBBY: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
