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

async function playing(tag, kicks = 6, turnMs) {
  const A = dev(tag + 'a'), B = dev(tag + 'b');
  const a = await api('/api/mp/duel', A, 'POST', { kicks, join: false, turnMs });
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
/* Played out DECISIVELY. Two identical kicks come out level, and level is no
   longer the end of a match — it goes to sudden death — so a rematch test that
   drew would sit in extra time forever. One scores, one puts it over. */
const SCORES = { power: 0.8, aimM: 2.2, curl: 0, elev: 0.35, x: 0, z: 11, wall: 0, t: 1 };
const MISSES = { power: 0.95, aimM: 0, curl: 0, elev: 0.98, x: 0, z: 11, wall: 0, t: 1 };
for (let i = 0; i < 2; i++) {
  const s = await sync(q.A, q.id);
  if (!s.json.live) break;
  const sd = s.json.live.role === 'striker' ? q.A : q.B;
  const kd = s.json.live.role === 'striker' ? q.B : q.A;
  await api('/api/mp/kick', sd, 'POST', { matchId: q.id, kickIndex: i,
    strike: i === 0 ? SCORES : MISSES });
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

console.log('\nA NAME, SO IT IS SOMEBODY RATHER THAN "PLAYER"');
const named = dev('named');
const setName = await api('/api/mp/name', named, 'POST', { name: '  Scath  ' });
ok('a name is accepted and tidied', setName.json.you && setName.json.you.handle === 'Scath',
   JSON.stringify(setName.json.you && setName.json.you.handle));
const longName = await api('/api/mp/name', named, 'POST', { name: 'x'.repeat(40) });
ok('an over-long one is cut, not refused', longName.json.you.handle.length === 14,
   JSON.stringify(longName.json.you.handle));
const nasty = await api('/api/mp/name', named, 'POST', { name: '<img src=x>Bob' });
ok('and markup is stripped rather than stored',
   !/[<>]/.test(nasty.json.you.handle), JSON.stringify(nasty.json.you.handle));
const bidi = await api('/api/mp/name', named, 'POST', { name: 'ab\u202Ecd' });
ok('so are the characters that rearrange the line they are printed on',
   !/[\u202A-\u202E]/.test(bidi.json.you.handle), JSON.stringify(bidi.json.you.handle));
const empty = await api('/api/mp/name', named, 'POST', { name: '   ' });
ok('a name of nothing is refused', empty.status === 400, String(empty.status));

/* and it reaches the other player, which is the whole point */
const n1 = dev('n1'), n2 = dev('n2');
await api('/api/mp/name', n1, 'POST', { name: 'Aoife' });
const nm = await api('/api/mp/duel', n1, 'POST', { kicks: 2, join: false });
await api('/api/mp/duel', n2, 'POST', { kicks: 2, matchId: nm.json.matchId });
const seen = await sync(n2, nm.json.matchId);
ok('the other end is told who they are playing',
   seen.json.opponent && seen.json.opponent.handle === 'Aoife',
   JSON.stringify(seen.json.opponent && seen.json.opponent.handle));

console.log('\nSUDDEN DEATH — level is not finished');
/* Two kicks, and both of them missed on purpose, so it comes out level. */
const sd = await playing('sd', 2);
async function bothMiss(id, i, A, B){
  const s = await sync(A, id);
  if(!s.json.live) return false;
  const sdev = s.json.live.role === 'striker' ? A : B;
  const kdev = s.json.live.role === 'striker' ? B : A;
  // straight over the bar: a miss whoever is in goal
  await api('/api/mp/kick', sdev, 'POST', { matchId: id, kickIndex: i,
    strike: { power: 0.95, aimM: 0, curl: 0, elev: 0.98, x: 0, z: 11, wall: 0, t: 1 } });
  await api('/api/mp/kick', kdev, 'POST', { matchId: id, kickIndex: i, dive: null });
  return true;
}
await bothMiss(sd.id, 0, sd.A, sd.B);
await bothMiss(sd.id, 1, sd.A, sd.B);
const afterTwo = await sync(sd.A, sd.id);
ok('level after the last kick does not end the match',
   afterTwo.json.state === 'in_progress', JSON.stringify(afterTwo.json.state));
ok('another PAIR is added, not another kick — one would hand it to whoever kicks',
   afterTwo.json.kicks === 4, String(afterTwo.json.kicks));
ok('and the next one is open and waiting', afterTwo.json.live &&
   afterTwo.json.live.kickIndex === 2, JSON.stringify(afterTwo.json.live));
ok('with the sides still alternating',
   (await sync(sd.B, sd.id)).json.live.role !== afterTwo.json.live.role);

/* Now one of them scores in extra time: that ends it. */
const s2 = await sync(sd.A, sd.id);
const winDev = s2.json.live.role === 'striker' ? sd.A : sd.B;
const loseDev = s2.json.live.role === 'striker' ? sd.B : sd.A;
await api('/api/mp/kick', winDev, 'POST', { matchId: sd.id, kickIndex: 2,
  strike: { power: 0.8, aimM: 2.2, curl: 0, elev: 0.35, x: 0, z: 11, wall: 0, t: 1 } });
await api('/api/mp/kick', loseDev, 'POST', { matchId: sd.id, kickIndex: 2, dive: null });
await bothMiss(sd.id, 3, sd.A, sd.B);
const done2 = await sync(sd.A, sd.id);
ok('a pair that is not level ends it', done2.json.state === 'settled',
   JSON.stringify({ state: done2.json.state, scores: done2.json.scores }));
ok('and somebody won', !!done2.json.winner, JSON.stringify(done2.json.winner));

console.log('\nTWO PLAYERS WHO HAVE BOTH STOPPED ARE JUST LEVEL');
/* Extending on a pair nobody took walks the match to the cap one
   twenty-five-second deadline at a time — four minutes of a screen doing
   nothing — and settles nothing, because neither of them is there. */
/* A blitz deadline, because this one has to sit through two of them: a pair is
   two kicks and each gets its own clock. */
const quit = await playing('quit', 2, 6000);
await bothMiss(quit.id, 0, quit.A, quit.B);
await bothMiss(quit.id, 1, quit.A, quit.B);
const inET = await sync(quit.A, quit.id);
ok('level after normal time still goes to extra time', inET.json.kicks === 4,
   String(inET.json.kicks));
/* now nobody plays the extra pair: let BOTH of its kicks time out */
console.log('  ..  waiting out a pair nobody takes');
let gaveUp = null;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 2000));
  gaveUp = await sync(quit.A, quit.id);
  if (gaveUp.json.state === 'settled') break;
}
ok('a pair nobody took ends it rather than buying another',
   gaveUp.json.state === 'settled', JSON.stringify({state: gaveUp.json.state, kicks: gaveUp.json.kicks}));
ok('and it is allowed to be a draw', gaveUp.json.winner === null,
   JSON.stringify(gaveUp.json.winner));

console.log('\nSUDDEN DEATH CANNOT RUN FOREVER');
/* Two players perfectly capable of missing all afternoon. The cap is the only
   thing between them and a match that never ends. */
const cap = await playing('cap', 2);
for (let i = 0; i < 40; i++) {
  if (!(await bothMiss(cap.id, i, cap.A, cap.B))) break;
}
const capped = await sync(cap.A, cap.id);
ok('it stops rather than extending forever', capped.json.state === 'settled',
   JSON.stringify({ state: capped.json.state, kicks: capped.json.kicks }));
ok('at the cap, and level is finally allowed to be level',
   capped.json.kicks <= 20 && capped.json.winner === null,
   JSON.stringify({ kicks: capped.json.kicks, winner: capped.json.winner }));

console.log('\n' + (fail ? 'DUEL ENDGAME: ' + fail + ' FAILED'
                         : 'DUEL ENDGAME: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
