/* Leaving, and going again — the two ends of a match that had no ending.
 *
 *   npx wrangler pages dev . --port 8788
 *   node tests/duel-endgame.mjs
 *
 * WALKING AWAY  a player who closes the tab used to cost the other one the
 *               rest of the match in twenty-five-second silences, one per
 *               remaining kick, with nothing on screen to say why. The match
 *               should end at once, on the score as it stands — not as a
 *               forfeit, because a dropped connection and a rage-quit look
 *               identical from the server and only one deserves a penalty.
 * GOING AGAIN   both have to want it, it happens exactly once however many
 *               times either of them asks, and the sides swap.
 */
const BASE = process.env.MP_BASE || 'http://localhost:8788';
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const dev = who => 'device-e-' + who + '-' + RUN + '0'.repeat(20);

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
const sync  = (d, id) => api('/api/mp/sync/' + id, d);
const ready = (d, id) => api('/api/mp/ready', d, 'POST', { matchId: id });
const leave = (d, id) => api('/api/mp/leave', d, 'POST', { matchId: id });
const again = (d, id) => api('/api/mp/again', d, 'POST', { matchId: id });

async function playing(tag, kicks = 6) {
  const A = dev(tag + 'a'), B = dev(tag + 'b');
  const a = await api('/api/mp/duel', A, 'POST', { kicks, join: false });
  await api('/api/mp/duel', B, 'POST', { kicks, matchId: a.json.matchId });
  await ready(A, a.json.matchId); await ready(B, a.json.matchId);
  return { A, B, id: a.json.matchId };
}

console.log('\nWALKING AWAY — the match ends, it does not drag');
const p = await playing('gone');
const live0 = await sync(p.A, p.id);
ok('a kick is open before anybody leaves', !!live0.json.live, JSON.stringify(live0.json.live));

/* Score something first, so "on the score as it stands" has something in it. */
const strikerDev = live0.json.live.role === 'striker' ? p.A : p.B;
const strikerSide = live0.json.live.role === 'striker' ? live0.json.side
                                                      : (live0.json.side === 'a' ? 'b' : 'a');
await api('/api/mp/kick', strikerDev, 'POST', {
  matchId: p.id, kickIndex: 0,
  strike: { power: 0.8, aimM: 2.2, curl: 0, elev: 0.35, x: 0, z: 11, wall: 0, t: 1 },
});
const keeperDev = strikerDev === p.A ? p.B : p.A;
await api('/api/mp/kick', keeperDev, 'POST', { matchId: p.id, kickIndex: 0, dive: null });

const before = await sync(p.A, p.id);
ok('and one kick has been decided', before.json.played.length === 1,
   JSON.stringify(before.json.played.length));

const bye = await leave(p.B, p.id);
ok('leaving is accepted', bye.status === 200 && bye.json.left === true, JSON.stringify(bye.json));

const after = await sync(p.A, p.id);
ok('the match is over at once, not five deadlines later',
   after.json.state === 'settled', JSON.stringify(after.json.state));
ok('the one who stayed is told the other walked',
   after.json.left && after.json.left.them === true && after.json.left.you === false,
   JSON.stringify(after.json.left));
ok('no kick is left open for somebody to wait on', !after.json.live,
   JSON.stringify(after.json.live));
ok('every kick is accounted for, the unplayed ones as timeouts',
   after.json.played.length === 6, String(after.json.played.length));
ok('the kicks nobody took scored nothing',
   after.json.played.filter(k => k.kickIndex > 0).every(k => k.outcome === 'timeout'),
   JSON.stringify(after.json.played.map(k => k.outcome)));

/* NOT a forfeit. The score is the score. */
const scored = before.json.played[0].value;
const finalA = after.json.scores[strikerSide];
ok('the result is the score as it stood, not a forfeit',
   finalA === scored, 'kick 0 was worth ' + scored + ', final ' + finalA);

ok('leaving twice changes nothing', (await leave(p.B, p.id)).status === 200);
const strangerLeave = await leave(dev('nosy'), p.id);
ok('somebody who is not in it cannot end it', strangerLeave.status === 403,
   String(strangerLeave.status));

console.log('\nA LOBBY NOBODY JOINED — retired, not settled');
const solo = dev('solo');
const lobby = await api('/api/mp/duel', solo, 'POST', { kicks: 2, join: false });
const dropped = await leave(solo, lobby.json.matchId);
ok('backing out of a lobby retires it', dropped.json.state === 'expired',
   JSON.stringify(dropped.json));
const ghost = await sync(solo, lobby.json.matchId);
ok('so nobody can join a corpse', ghost.json.state === 'expired',
   JSON.stringify(ghost.json.state));

console.log('\nGOING AGAIN — both have to want it');
const q = await playing('again', 2);
/* play it out */
for (let i = 0; i < 2; i++) {
  const s = await sync(q.A, q.id);
  if (!s.json.live) break;
  const sd = s.json.live.role === 'striker' ? q.A : q.B;
  const kd = s.json.live.role === 'striker' ? q.B : q.A;
  await api('/api/mp/kick', sd, 'POST', { matchId: q.id, kickIndex: i,
    strike: { power: 0.75, aimM: 1.8, curl: 0, elev: 0.4, x: 0, z: 11, wall: 0, t: 1 } });
  await api('/api/mp/kick', kd, 'POST', { matchId: q.id, kickIndex: i, dive: null });
}
const done = await sync(q.A, q.id);
ok('the match finished', done.json.state === 'settled', JSON.stringify(done.json.state));
ok('and neither has asked for another yet',
   done.json.again && !done.json.again.you && !done.json.again.them,
   JSON.stringify(done.json.again));

const askA = await again(q.A, q.id);
ok('one asking is not enough', askA.json.matchId === null, JSON.stringify(askA.json));
ok('and they are told they are waiting',
   askA.json.again.you === true && askA.json.again.them === false, JSON.stringify(askA.json.again));
const seenByB = await sync(q.B, q.id);
ok('the other is told somebody wants another', seenByB.json.again.them === true,
   JSON.stringify(seenByB.json.again));

const askB = await again(q.B, q.id);
ok('the second ask makes the match', typeof askB.json.matchId === 'string',
   JSON.stringify(askB.json));
const rematch = askB.json.matchId;
ok('and it is a different match', rematch !== q.id, rematch + ' vs ' + q.id);

const backToA = await sync(q.A, q.id);
ok('the one who asked first is handed the same id, not a second match',
   backToA.json.again.matchId === rematch,
   backToA.json.again.matchId + ' vs ' + rematch);
const askAgainA = await again(q.A, q.id);
ok('asking repeatedly never makes a third match', askAgainA.json.matchId === rematch,
   askAgainA.json.matchId + ' vs ' + rematch);

const newA = await sync(q.A, rematch);
const newB = await sync(q.B, rematch);
ok('both are in the rematch', newA.status === 200 && newB.status === 200);
ok('on opposite sides', newA.json.side !== newB.json.side,
   newA.json.side + ' / ' + newB.json.side);
ok('sides swapped, so the same person does not kick first twice',
   newA.json.side !== done.json.side, done.json.side + ' -> ' + newA.json.side);
ok('and it has not started — the ready gate applies to a rematch too',
   !newA.json.live && newA.json.ready.both === false, JSON.stringify(newA.json.live));

console.log('\n' + (fail ? 'DUEL ENDGAME: ' + fail + ' FAILED'
                         : 'DUEL ENDGAME: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
