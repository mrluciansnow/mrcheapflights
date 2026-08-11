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

console.log('\nTHE FIRST TIME, THE RULES FIRST');
/* Online has rules the offline game does not — both ends live at once, and a
   read that lies to you — so the way in explains them once before the lobby. */
await A.click('#bOnline');
await A.waitForTimeout(300);
ok('a first-timer is shown how it works', await shown(A, 'ovTut'));
ok('and can leave on the first tap',
   await A.evaluate(() => !document.getElementById('bTutSkip').classList.contains('hidden')));
await A.click('#bTutSkip');
await A.waitForTimeout(250);
ok('skipping drops straight into the lobby', await shown(A, 'ovOnline'));
ok('and it is remembered, so it is shown once',
   await A.evaluate(() => JSON.parse(localStorage.getItem('crokerFlicks.v2')).seenTut === true));

console.log('\nTHE BUTTON OPENS A LOBBY');
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
if(await shown(B, 'ovTut')) await B.click('#bTutSkip');
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

console.log('\nBOTH HERE, BOTH READY');
/* The lobby does not get out of the way on its own any more. A deadline that
   starts the moment a stranger is found runs while somebody is still reading
   the screen, so both press READY and nothing opens until they have. */
ok('the host is shown the ready panel', await until(A, () =>
   !document.getElementById('mpReady').classList.contains('hidden'), 8000, 'A ready panel'));
ok('and so is the joiner', await until(B, () =>
   !document.getElementById('mpReady').classList.contains('hidden'), 8000, 'B ready panel'));
ok('each is told the other is actually there', await until(A, () => {
   const t = document.getElementById('rdyThem');
   return /here|ready/i.test(t.querySelector('i').textContent);
}, 10000, 'A to see B'), await A.evaluate(() =>
   document.getElementById('rdyThem').querySelector('i').textContent));
/* The chat drawer is not an overlay, so `.hidden` on it does nothing unless a
   rule says so. It sat open on the title screen once. */
ok('the chat drawer is not open before anybody asked for it',
   await A.evaluate(() => getComputedStyle(document.getElementById('chatWrap')).display === 'none'));
ok('and no kick has opened yet', !(await st(A)).live, JSON.stringify((await st(A)).live));

await A.click('#bReadyUp');
await A.waitForTimeout(400);
ok('one of them pressing it does not start anything',
   !(await st(A)).live, JSON.stringify((await st(A)).live));
ok('the button says what it is waiting for',
   /waiting/i.test(await A.evaluate(() => document.getElementById('bReadyUp').textContent)),
   await A.evaluate(() => document.getElementById('bReadyUp').textContent));
await B.click('#bReadyUp');

/* B presses second, and that is the case that used to strand somebody: their
   own copy of `ready` was updated by the POST's reply, so the next poll saw
   nothing new, never called back, and left them sitting on the lobby while
   the match started without them. The one who presses SECOND is the test. */
ok('once both have, the overlay closes for the host', await until(A, () =>
   document.getElementById('ovOnline').classList.contains('hidden'), 8000, 'A overlay to close'));
ok('and for the joiner, who pressed it second', await until(B, () =>
   document.getElementById('ovOnline').classList.contains('hidden'), 8000, 'B overlay to close'));
ok('neither is left looking at a lobby while the other plays',
   await A.evaluate(() => document.getElementById('mpReady').classList.contains('hidden')) &&
   await B.evaluate(() => document.getElementById('mpReady').classList.contains('hidden')));
ok('and the way to talk to each other appears', await until(A, () =>
   !document.getElementById('talk').classList.contains('hidden'), 5000, 'A talk buttons'));

console.log('\nAND THEY ARE BOTH IN THE SAME KICK');
await until(A, () => ['AIM', 'KEEP'].includes(window.CF.net.state.phase), 20000, 'A into the kick');
await until(B, () => ['AIM', 'KEEP'].includes(window.CF.net.state.phase), 20000, 'B into the kick');
const a1 = await st(A), b1 = await st(B);
ok('one is on the ball and the other in goal',
   (a1.phase === 'AIM' && b1.phase === 'KEEP') || (a1.phase === 'KEEP' && b1.phase === 'AIM'),
   a1.phase + ' / ' + b1.phase);
ok('inside the same kick', a1.live?.kickIndex === b1.live?.kickIndex);
ok('on the same clock', a1.live?.openedAt === b1.live?.openedAt);

console.log('\nTHE HUD KNOWS IT IS AN ONLINE MATCH');
/* The round bar used to say "QUICK MATCH · Senior" for the whole of a duel,
   naming neither the person you were playing nor how far through it you were,
   and the streak line said nothing at all where the scoreline should be. */
await until(A, () => /ONLINE/.test(document.getElementById('rbL').textContent),
            8000, 'the bar to say ONLINE');
const bar = await A.evaluate(() => ({
  line: document.getElementById('rbL').textContent,
  score: document.getElementById('rbS').textContent,
}));
ok('the bar says it is online and which kick', /ONLINE/.test(bar.line) && /KICK \d+\/\d+/.test(bar.line),
   JSON.stringify(bar.line));
ok('and carries the scoreline rather than a streak', /YOU \d+ – \d+ THEM/.test(bar.score),
   JSON.stringify(bar.score));

console.log('\nCHAT IS REACHABLE, NOT BURIED');
ok('the way to talk is on screen during a match',
   await A.evaluate(() => !document.getElementById('talk').classList.contains('hidden')));

console.log('\nCOMING BACK AFTER THE PAGE GOES AWAY');
/* The match id lived only in memory, so a refresh ended the match with no way
   back — and left the other player waiting on somebody who could not return. */
const remembered = await A.evaluate(() => localStorage.getItem('crokerFlicks.duel'));
ok('the match is remembered across a reload', !!remembered, JSON.stringify(remembered));
await A.reload({ waitUntil: 'domcontentloaded' });
await A.waitForTimeout(700);
await A.click('#bOnline');
await A.waitForTimeout(300);
if(await shown(A, 'ovTut')) await A.click('#bTutSkip');
ok('and coming back offers to rejoin it rather than starting from scratch',
   await until(A, () => !document.getElementById('mpResume').classList.contains('hidden'),
               12000, 'the rejoin offer'),
   await A.evaluate(() => document.getElementById('mpMsg').textContent));
ok('naming who it is against',
   /against|in progress/i.test(await A.evaluate(() =>
     document.getElementById('mpResumeWho').textContent)),
   await A.evaluate(() => document.getElementById('mpResumeWho').textContent));
await A.click('#bResume2');
ok('rejoining puts you back in the match',
   await until(A, () => window.CF.net.state.state === 'in_progress', 15000, 'A to rejoin'),
   JSON.stringify((await st(A)).state));

console.log('\nGIVING UP TELLS THE OTHER PLAYER');
await A.evaluate(() => window.CF.net.leave());
const told = await until(B, () => window.CF.net.state.walked && window.CF.net.state.walked.them === true,
                         15000, 'B to be told A left');
if(!told) console.log('  ..  B state: ' + JSON.stringify(await st(B)).slice(0, 400));
ok('the one who stayed is told, rather than playing out deadlines', told,
   JSON.stringify((await st(B)).walked));
ok('and the match is over for them at once',
   await until(B, () => ['settled', 'resolved'].includes(window.CF.net.state.state),
               15000, 'B match to end'),
   JSON.stringify((await st(B)).state));

console.log('\nA BAD CODE IS SURVIVABLE');
const C = await client('c');
await C.click('#bOnline');
await C.waitForTimeout(250);
if(await shown(C, 'ovTut')) await C.click('#bTutSkip');
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
