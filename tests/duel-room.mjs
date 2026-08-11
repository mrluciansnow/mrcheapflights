/* The room around the kick: being ready, being seen, being read, and talking.
 *
 *   npx wrangler pages dev . --port 8788
 *   node tests/duel-room.mjs
 *
 * Four properties, and three of them are things that can only be got wrong on
 * a server:
 *
 *   READY     no kick opens — and no deadline runs — until both players have
 *             said they are there. Being paired is not being ready.
 *   PRESENCE  each side can see whether the other is still on the other end.
 *   THE READ  once a half is submitted the other player is allowed to notice
 *             ONE OF THREE, often wrong — and never the submission itself.
 *             This is the one that has to be attacked rather than checked:
 *             the tell must not be resamplable, and it must not leak power,
 *             curl, placement or timing beyond the moment it happened.
 *   TALK      chat reaches the other player, signalling reaches the other
 *             browser, and neither is readable by anyone else.
 */
const BASE = process.env.MP_BASE || 'http://localhost:8788';
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const dev = who => 'device-r-' + who + '-' + RUN + '0'.repeat(20);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};
async function api(path, device, method = 'GET', body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'X-CF-Device': device, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const sync  = (d, id, since) => api('/api/mp/sync/' + id + (since ? '?since=' + since : ''), d);
const ready = (d, id) => api('/api/mp/ready', d, 'POST', { matchId: id });
const kick  = (d, body) => api('/api/mp/kick', d, 'POST', body);

/* A fresh pair, joined but not ready. */
async function pair(tag, kicks = 6) {
  const A = dev(tag + 'a'), B = dev(tag + 'b');
  const a = await api('/api/mp/duel', A, 'POST', { kicks, join: false });
  const b = await api('/api/mp/duel', B, 'POST', { kicks, matchId: a.json.matchId });
  return { A, B, id: a.json.matchId, opened: a.json, joined: b.json };
}

console.log('\nREADY — being paired is not being ready');
const p = await pair('ready');
ok('the pair is in a match', p.joined.state === 'in_progress', JSON.stringify(p.joined.state));
const before = await sync(p.A, p.id);
ok('but no kick is open yet', before.json.live === null, JSON.stringify(before.json.live));
ok('and neither of them is marked ready',
   before.json.ready && !before.json.ready.you && !before.json.ready.them,
   JSON.stringify(before.json.ready));

const r1 = await ready(p.A, p.id);
ok('one of them says ready', r1.json.ready.you === true && r1.json.ready.both === false,
   JSON.stringify(r1.json.ready));
const half = await sync(p.A, p.id);
ok('one is not enough — still no kick, so no deadline is running',
   half.json.live === null, JSON.stringify(half.json.live));
const seenByB = await sync(p.B, p.id);
ok('the other can see they are waiting on themselves',
   seenByB.json.ready.them === true && seenByB.json.ready.you === false,
   JSON.stringify(seenByB.json.ready));

const r2 = await ready(p.B, p.id);
ok('both ready', r2.json.ready.both === true, JSON.stringify(r2.json.ready));
const live = await sync(p.A, p.id);
ok('and the first kick opens', live.json.live && live.json.live.kickIndex === 0,
   JSON.stringify(live.json.live));
ok('with a deadline that starts now, not when they were paired',
   live.json.live.deadline - live.json.serverTime > 1,
   'left: ' + (live.json.live.deadline - live.json.serverTime));
const again = await ready(p.A, p.id);
ok('saying ready twice is the same as saying it once', again.json.ready.both === true);

console.log('\nPRESENCE — is anybody actually there');
ok('each side is told about the other', !!live.json.opponent, JSON.stringify(live.json.opponent));
ok('and told they are here', live.json.opponent.here === true,
   JSON.stringify({ here: live.json.opponent.here, ago: live.json.opponent.seenAgo }));
ok('presence is about them, not you',
   live.json.opponent.id !== live.json.you.id, 'same player came back as the opponent');

console.log('\nTHE READ — one of three, often wrong, never the submission');
/* Whoever is striking submits; the keeper is then allowed to notice something. */
const strikerDev = live.json.live.role === 'striker' ? p.A : p.B;
const keeperDev  = live.json.live.role === 'striker' ? p.B : p.A;

const keeperBefore = await sync(keeperDev, p.id);
ok('before the strike the keeper is told nothing at all',
   keeperBefore.json.live.read === null || keeperBefore.json.live.read === undefined,
   JSON.stringify(keeperBefore.json.live.read));

const swipe = { power: 0.8, aimM: -2.4, curl: 0.1, elev: 0.5, x: 0, z: 11, wall: 0, t: 1.4 };
await kick(strikerDev, { matchId: p.id, kickIndex: 0, strike: swipe });

const afterStrike = await sync(keeperDev, p.id);
const read = afterStrike.json.live.read;
ok('after it the keeper is allowed to notice something', !!read, JSON.stringify(read));
ok('and it is a direction, not a placement',
   read && [-1, 0, 1].includes(read.dir) && read.aimM === undefined && read.power === undefined
        && read.curl === undefined && read.elev === undefined,
   JSON.stringify(read));
ok('with the moment it happened, which is what makes reacting late cost something',
   read && Math.abs(read.at - swipe.t) < 0.001, JSON.stringify(read && read.at));

const read2 = (await sync(keeperDev, p.id)).json.live.read;
ok('asking again gives the SAME tell — a lie cannot be resampled into the truth',
   JSON.stringify(read) === JSON.stringify(read2),
   JSON.stringify(read) + ' vs ' + JSON.stringify(read2));

const strikerView = await sync(strikerDev, p.id);
ok('the striker is told nothing, because the keeper has not gone',
   strikerView.json.live.read === null || strikerView.json.live.read === undefined,
   JSON.stringify(strikerView.json.live.read));
ok('and still cannot see their own submission echoed back as the opponent\'s',
   !strikerView.json.live.strike && !strikerView.json.live.dive,
   JSON.stringify(strikerView.json.live));

console.log('\nTHE READ IS OFTEN WRONG — measured, not asserted');
/* One kick cannot show a rate. Run the pure function across many kick indices
   through the API's own arithmetic by opening many duels would be slow, so
   this checks the property the API guarantees: across matches, the tell is not
   simply the truth. A wired-through tell that always told the truth would make
   the keeper unbeatable, and it is the one failure that looks fine on one kick. */
let told = 0, truth = 0;
for (let i = 0; i < 12; i++) {
  const q = await pair('read' + i, 2);
  await ready(q.A, q.id); await ready(q.B, q.id);
  const s = await sync(q.A, q.id);
  if (!s.json.live) continue;
  const sd = s.json.live.role === 'striker' ? q.A : q.B;
  const kd = s.json.live.role === 'striker' ? q.B : q.A;
  await kick(sd, { matchId: q.id, kickIndex: 0,
                   strike: { power: 0.8, aimM: 2.4, curl: 0, elev: 0.5, x: 0, z: 11, wall: 0, t: 1 } });
  const rr = (await sync(kd, q.id)).json.live.read;
  if (rr) { told++; if (rr.dir === 1) truth++; }
}
ok('every keeper got a tell once the ball was struck', told === 12, told + '/12');
ok('and the tell is not always the truth — it lies often enough to be beaten',
   truth < told, truth + ' of ' + told + ' were true');
console.log('  ..  ' + truth + '/' + told + ' truthful this run (design target ~68%)');

console.log('\nTALK — chat to the room, signalling to the browser');
const say = (d, kind, body) => api('/api/mp/say', d, 'POST', { matchId: p.id, kind, body });
const c1 = await say(p.A, 'chat', 'good save');
ok('a line of chat is accepted', c1.json.sent === true, JSON.stringify(c1.json));
const bSees = await sync(p.B, p.id);
const chats = bSees.json.says.filter(s => s.kind === 'chat');
ok('and reaches the other player', chats.some(s => s.body === 'good save'),
   JSON.stringify(bSees.json.says));
ok('marked as theirs, not mine', chats.every(s => s.mine === false));
const aSees = await sync(p.A, p.id);
ok('the sender sees their own line too, so both show one transcript',
   aSees.json.says.some(s => s.kind === 'chat' && s.body === 'good save' && s.mine === true),
   JSON.stringify(aSees.json.says));

const lastId = Math.max(...aSees.json.says.map(s => s.id));
const nothingNew = await sync(p.A, p.id, lastId);
ok('`since` means a poll never re-reads the conversation',
   nothingNew.json.says.length === 0, JSON.stringify(nothingNew.json.says));

await say(p.A, 'rtc', JSON.stringify({ type: 'offer', sdp: 'v=0…' }));
const bRtc = (await sync(p.B, p.id, lastId)).json.says.filter(s => s.kind === 'rtc');
ok('a signalling message reaches the other browser', bRtc.length === 1, JSON.stringify(bRtc));
const aRtc = (await sync(p.A, p.id, lastId)).json.says.filter(s => s.kind === 'rtc');
ok('and is not echoed back to the browser that sent it', aRtc.length === 0, JSON.stringify(aRtc));

const tooLong = await say(p.A, 'chat', 'x'.repeat(400));
ok('an over-long line is refused rather than stored', tooLong.status === 400,
   String(tooLong.status));
const badKind = await say(p.A, 'shout', 'hello');
ok('and so is a kind the server does not serve', badKind.status === 400, String(badKind.status));

const stranger = dev('nosy');
const peek = await sync(stranger, p.id);
ok('somebody who is not in the match cannot read the room', peek.status === 403,
   String(peek.status));
const shout = await api('/api/mp/say', stranger, 'POST',
                        { matchId: p.id, kind: 'chat', body: 'hello' });
ok('nor talk into it', shout.status === 403, String(shout.status));

console.log('\n' + (fail ? 'DUEL ROOM: ' + fail + ' FAILED' : 'DUEL ROOM: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
