/* Chat and voice, driven the way two players drive them.
 *
 *   npx wrangler pages dev . --port 8788
 *   node tests/duel-talk.mjs
 *
 * The room suite proves the TRANSPORT: a line reaches the server and comes
 * back addressed correctly. That is not the same as the feature working, and
 * the gap between them is where this lives:
 *
 *   CHAT   typed into the box on one screen, appearing on the other, in the
 *          server's order, attributed to the right person.
 *   VOICE  a real RTCPeerConnection, negotiated over the poll, reaching
 *          `connected` with an audio track flowing. Signalling being
 *          delivered proves the postman works, not that the call connects.
 *
 * Chromium is launched with fake media devices, so getUserMedia returns a
 * synthetic microphone and no permission prompt blocks the run. Both pages
 * are on localhost, so ICE succeeds on host candidates — which means this
 * proves the negotiation, NOT that it survives a real network. See the note
 * on TURN at the bottom.
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

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
         '--autoplay-policy=no-user-gesture-required'],
});
async function client(tag) {
  const ctx = await browser.newContext();
  /* Granted against the origin, not globally: a bare permissions list on the
     context is not applied to a page that navigates afterwards. */
  await ctx.grantPermissions(['microphone'], { origin: BASE });
  const p = await ctx.newPage();
  await p.route('**fonts.googleapis.com**', r => r.abort());
  await p.goto(GAME, { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => {
    localStorage.setItem('crokerFlicks.device',
      'd_' + t + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('crokerFlicks.v2', JSON.stringify({
      v: 2, seenCoach: true, seenTut: true, xp: 20000, money: 9000,
      unlocked: ['Dublin'], kit: 'std', kits: ['std'], awards: [],
      gk: 'gk-std', gks: ['gk-std'], ball: 'ball-std', balls: ['ball-std'],
    }));
  }, tag);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  p.__errs = [];
  p.on('pageerror', e => p.__errs.push(e.message));
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
const lines = p => p.evaluate(() =>
  [...document.querySelectorAll('#chatLog p')].map(e => e.className + ':' + e.textContent));
/* #bChat toggles, so a test that just clicks it half the time closes the
   drawer it meant to open. Say which state is wanted. */
const shown = p => p.evaluate(() =>
  !document.getElementById('chatWrap').classList.contains('hidden'));
async function drawer(p, want) {
  if (await shown(p) !== want) await p.click('#bChat');
}

const A = await client('a'), B = await client('b');
const opened = await A.evaluate(() => window.CF.net.play({ kicks: 2, join: false }));
await B.evaluate(id => window.CF.net.play({ matchId: id }), opened.matchId);
await until(A, () => !!window.CF.net.state.opponent, 20000, 'the pair to see each other');
await A.evaluate(() => window.CF.net.ready());
await B.evaluate(() => window.CF.net.ready());
await until(A, () => window.CF.net.state.phase !== 'NET_WAIT', 20000, 'the match to start');

console.log('\nCHAT — typed on one screen, read on the other');
await drawer(A, true);     // a real pointer event, which is the whole point
ok('the drawer opens', await A.evaluate(() =>
  !document.getElementById('chatWrap').classList.contains('hidden')));
await A.fill('#chatIn', 'good luck');
await A.click('#bChatSend');

ok('it reaches the other player',
   await until(B, () => [...document.querySelectorAll('#chatLog p')]
     .some(e => e.textContent === 'good luck'), 12000, 'B to receive'),
   JSON.stringify(await lines(B)));
ok('attributed to them, not to me',
   (await lines(B)).includes('them:good luck'), JSON.stringify(await lines(B)));
ok('and the sender sees their own line, so both show one transcript',
   await until(A, () => [...document.querySelectorAll('#chatLog p')]
     .some(e => e.className === 'me' && e.textContent === 'good luck'), 12000, 'A to see its own'),
   JSON.stringify(await lines(A)));
ok('the box is cleared after sending',
   (await A.evaluate(() => document.getElementById('chatIn').value)) === '');

/* A quick line, which is the one a player actually uses with a clock running */
await drawer(B, true);
await B.click('#chatQuick button:has-text("Nice one")');
ok('a quick line sends too',
   await until(A, () => [...document.querySelectorAll('#chatLog p')]
     .some(e => e.textContent === 'Nice one'), 12000, 'the quick line'),
   JSON.stringify(await lines(A)));

ok('order is the server\'s, the same on both screens',
   JSON.stringify((await lines(A)).filter(l => !l.startsWith('sys')).map(l => l.split(':')[1])) ===
   JSON.stringify((await lines(B)).filter(l => !l.startsWith('sys')).map(l => l.split(':')[1])),
   JSON.stringify([await lines(A), await lines(B)]));

await drawer(B, false);                      // shut, so an arrival must flag itself
const unread = await B.evaluate(() =>
  document.getElementById('talkDot').classList.contains('hidden'));
await A.fill('#chatIn', 'behind you');
await A.click('#bChatSend');
ok('a line arriving while the drawer is shut raises the unread dot',
   await until(B, () => !document.getElementById('talkDot').classList.contains('hidden'),
               12000, 'the unread dot'), 'dot was hidden before: ' + unread);

console.log('\nTHE SERVERS A CALL IS GIVEN');
/* STUN alone is enough on wifi and not enough on mobile: behind carrier-grade
   NAT the address STUN reports is not the address packets arrive from. Voice
   shipped STUN-only, so it worked in every test and failed on 4G with nothing
   on screen to say why. */
const ice = await A.evaluate(async () => {
  const r = await fetch('/api/mp/ice', {headers:{'X-CF-Device':
    localStorage.getItem('crokerFlicks.device')}});
  return {status: r.status, body: await r.json()};
});
ok('the client is told which servers to use', ice.status === 200 &&
   Array.isArray(ice.body.iceServers) && ice.body.iceServers.length > 0,
   JSON.stringify(ice.body));
ok('STUN is always there', ice.body.iceServers.some(s => /^stun:/.test(
   Array.isArray(s.urls) ? s.urls[0] : s.urls)), JSON.stringify(ice.body.iceServers));
ok('and it says plainly whether a relay is available',
   typeof ice.body.relay === 'boolean', JSON.stringify(ice.body.relay));
console.log('  ..  relay configured on this deployment: ' + ice.body.relay);
const anon = await A.evaluate(async () => (await fetch('/api/mp/ice')).status);
ok('credentials are not handed to anyone who asks', anon === 401, String(anon));

console.log('\nVOICE — a real peer connection, not just signalling');
/* This sandbox has no audio stack: getUserMedia returns NotAllowedError here
   however Chromium is launched, with or without the fake-device flags. So the
   microphone itself cannot be exercised in CI — that is the browser's own
   permission dialogue and is not ours to test anyway.
 *
 * Everything AFTER it can be, and is what actually breaks: the offer and
 * answer travelling over the poll, ICE completing, the connection reaching
 * `connected`, and audio packets moving in both directions. A synthetic track
 * from an oscillator stands in for the microphone, so the code under test is
 * exactly the code that runs in production from that point on. */
const fakeMic = p => p.evaluate(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AC();
    const osc = ac.createOscillator();
    const dst = ac.createMediaStreamDestination();
    osc.connect(dst); osc.start();
    return dst.stream;
  };
});
await fakeMic(A); await fakeMic(B);
await A.click('#bMic');
ok('the microphone is taken', await until(A, () => window.CF.net.state.mic === 'live',
   15000, 'A microphone'), JSON.stringify((await A.evaluate(() => window.CF.net.state)).mic));
/* The connection has to be BUILT from those servers, not from a hardcoded
   list — that was the bug, and a fetch that succeeds while the peer ignores
   it would look identical from outside. */
/* `mic` goes live before the connection is built — the servers are fetched in
   between — so this has to wait for the peer rather than read straight after. */
await until(A, () => !!(window.CF.talk && window.CF.talk.pc), 10000, 'A peer connection');
const used = await A.evaluate(() => {
  const pc = window.CF.talk && window.CF.talk.pc;
  return pc ? (pc.getConfiguration().iceServers || []).length : -1;
});
ok('and the peer connection was built from them', used === ice.body.iceServers.length,
   used + ' servers on the connection, ' + ice.body.iceServers.length + ' from the API');

/* The other end answers automatically when the offer arrives. */
ok('the other end picks up', await until(B, () => window.CF.net.state.mic === 'live',
   20000, 'B microphone'), JSON.stringify((await B.evaluate(() => window.CF.net.state)).mic));

const connected = p => p.evaluate(() => {
  const pc = window.CF.talk && window.CF.talk.pc;
  return pc ? pc.connectionState : 'no peer connection';
});
ok('A\'s peer connection reaches connected',
   await until(A, () => {
     const pc = window.CF.talk && window.CF.talk.pc;
     return pc && pc.connectionState === 'connected';
   }, 25000, 'A ICE'), await connected(A));
ok('and B\'s does too',
   await until(B, () => {
     const pc = window.CF.talk && window.CF.talk.pc;
     return pc && pc.connectionState === 'connected';
   }, 25000, 'B ICE'), await connected(B));

const flowing = p => p.evaluate(async () => {
  const pc = window.CF.talk && window.CF.talk.pc;
  if (!pc) return { err: 'no peer connection' };
  const stats = await pc.getStats();
  let out = 0, inn = 0;
  stats.forEach(s => {
    if (s.type === 'outbound-rtp' && s.kind === 'audio') out = s.packetsSent || 0;
    if (s.type === 'inbound-rtp' && s.kind === 'audio') inn = s.packetsReceived || 0;
  });
  return { out, inn };
});
await A.waitForTimeout(2500);
const fa = await flowing(A), fb = await flowing(B);
ok('audio packets are actually leaving A', (fa.out || 0) > 0, JSON.stringify(fa));
ok('and arriving at B', (fb.inn || 0) > 0, JSON.stringify(fb));
ok('and the other way round', (fb.out || 0) > 0 && (fa.inn || 0) > 0,
   JSON.stringify({ A: fa, B: fb }));

console.log('\nHANGING UP');
await A.click('#bMic');
ok('the microphone is released', await until(A, () => window.CF.net.state.mic === 'off',
   10000, 'A to hang up'), JSON.stringify((await A.evaluate(() => window.CF.net.state)).mic));
ok('and chat still works afterwards', await (async () => {
  await drawer(A, true);     // a real pointer event, which is the whole point
  await A.fill('#chatIn', 'still here');
  await A.click('#bChatSend');
  return until(B, () => [...document.querySelectorAll('#chatLog p')]
    .some(e => e.textContent === 'still here'), 12000, 'chat after hang-up');
})());

const errs = [...A.__errs, ...B.__errs];
ok('no runtime errors through any of it', errs.length === 0, errs.join(' | '));

await browser.close();
console.log('\n' + (fail ? 'DUEL TALK: ' + fail + ' FAILED' : 'DUEL TALK: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
