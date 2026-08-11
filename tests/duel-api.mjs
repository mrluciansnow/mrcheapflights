/* End-to-end test of the online duel API against a local Pages dev server.
 *
 *   npm run migrate          # applies every migration, in order, once
 *   npx wrangler pages dev . --port 8788
 *   node tests/duel-api.mjs
 *
 * A duel is a kick with two players in it. The properties that make that work
 * are not obvious from reading the endpoints, so they are asserted here:
 *
 *   BLINDNESS   neither side can learn anything about the other's submission
 *               until the kick resolves — not the input, not even whether it
 *               has arrived
 *   AUTHORITY   the outcome is the server's re-simulation, and it matches the
 *               client's simulation of the same record exactly
 *   IDEMPOTENCE a resubmitted half is a no-op, not a second kick
 *   LIVENESS    a player who walks away loses the kick on a deadline rather
 *               than freezing the match
 *   ONE PAYOUT  settlement is safe to call from both players, repeatedly
 */
import { simulate } from '../functions/_lib/sim.js';

const BASE = process.env.MP_BASE || 'http://localhost:8788';
/* Fresh identities per run. The matchmaking queue is shared state, so reusing
   tokens would let a previous run's abandoned lobby decide this one's roles —
   which is exactly the flakiness that hid a missing feature the first time. */
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const dev = who => 'device-duel-' + who + '-' + RUN + '0'.repeat(20);
const A = dev('a'), B = dev('b'), C = dev('c');

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
const sync = (dev, id) => api('/api/mp/sync/' + id, dev);
const SWIPE = { power: 0.72, aimM: 2.6, curl: 0.28, elev: 0.35, x: 0, z: 11, wall: 0 };
const DIVE = { x: -2.2, y: 0.9, at: 0.12 };

console.log('\nAUTH');
const noDev = await fetch(BASE + '/api/mp/duel', { method: 'POST' });
ok('a duel cannot be opened without a device token', noDev.status === 401);

console.log('\nMATCHMAKING');
const dA = await api('/api/mp/duel', A, 'POST', { kicks: 2, difficulty: 'senior', join: false });
ok('A opens a duel', dA.status === 200 && dA.json.state === 'waiting', JSON.stringify(dA.json));
ok('the server issues the seed', typeof dA.json.seed === 'number');
ok('an odd kick count would be unfair, so it is even', dA.json.kicks % 2 === 0);
const dB = await api('/api/mp/duel', B, 'POST', { matchId: dA.json.matchId });
ok('B joins that exact duel', dB.json.matchId === dA.json.matchId && dB.json.state === 'in_progress',
   JSON.stringify(dB.json));
const gate = await api('/api/mp/duel', C, 'POST', { matchId: dA.json.matchId });
ok('and a third player cannot join a full one', gate.status === 409, JSON.stringify(gate.json));
ok('both are told the same seed', dB.json.seed === dA.json.seed);
ok('and the same weather, which neither of them chose',
   dB.json.weather === dA.json.weather && Number.isInteger(dA.json.weather),
   JSON.stringify([dA.json.weather, dB.json.weather]));
ok('they are on opposite sides', dA.json.side === 'a' && dB.json.side === 'b');
const MID = dA.json.matchId;
/* Being paired is not being ready — see tests/duel-room.mjs. Nothing opens,
   and no deadline runs, until both have said they are there. */
const ready = (d, id) => api('/api/mp/ready', d, 'POST', { matchId: id });
await ready(A, MID); await ready(B, MID);
const SEED = dA.json.seed >>> 0;

console.log('\nROLES');
const sA0 = await sync(A, MID), sB0 = await sync(B, MID);
ok('kick 0 is live for both', sA0.json.live?.kickIndex === 0 && sB0.json.live?.kickIndex === 0,
   JSON.stringify([sA0.json.live, sB0.json.live]));
ok('A strikes first', sA0.json.live?.role === 'striker', JSON.stringify(sA0.json.live));
ok('B is in goal', sB0.json.live?.role === 'keeper', JSON.stringify(sB0.json.live));
ok('both are given the same deadline', sA0.json.live?.deadline === sB0.json.live?.deadline);
ok('a deadline is in the future', sA0.json.live?.deadline > sA0.json.serverTime);

console.log('\nOUTSIDERS');
const outsider = await sync(C, MID);
ok('a third player cannot read the match', outsider.status === 403, JSON.stringify(outsider.json));
const cKick = await api('/api/mp/kick', C, 'POST', { matchId: MID, kickIndex: 0, strike: SWIPE });
ok('nor submit into it', cKick.status === 403);

console.log('\nVALIDATION');
const wrongHalf = await api('/api/mp/kick', A, 'POST', { matchId: MID, kickIndex: 0, dive: DIVE });
ok('the striker cannot submit a dive', wrongHalf.status === 400 && /missing strike/.test(wrongHalf.json.error),
   JSON.stringify(wrongHalf.json));
const badPow = await api('/api/mp/kick', A, 'POST',
  { matchId: MID, kickIndex: 0, strike: { ...SWIPE, power: 9 } });
ok('an impossible power is rejected', badPow.status === 400, JSON.stringify(badPow.json));
const badDive = await api('/api/mp/kick', B, 'POST',
  { matchId: MID, kickIndex: 0, dive: { x: 99, y: 1, at: 0 } });
ok('a dive outside the goal is rejected', badDive.status === 400, JSON.stringify(badDive.json));

console.log('\nBLINDNESS — the property the whole duel rests on');
const subA = await api('/api/mp/kick', A, 'POST',
  { matchId: MID, kickIndex: 0, strike: { ...SWIPE, outcome: 'goal', value: 3, xp: 99999 } });
ok('A submits the strike', subA.status === 200 && subA.json.accepted, JSON.stringify(subA.json));
ok('and is not handed a result yet', !subA.json.kick.resolved, JSON.stringify(subA.json.kick));

const peek = await sync(B, MID);
const liveB = peek.json.live || {};
const blob = JSON.stringify(peek.json);
ok('B is not shown the strike', liveB.strike === undefined, blob.slice(0, 300));
ok('B is not even told it has arrived', liveB.submitted === false, JSON.stringify(liveB));
ok('nor is the swipe leaking anywhere else in the payload',
   !blob.includes('"aimM"') && !blob.includes(String(SWIPE.power)), blob.slice(0, 300));
ok('B still knows its own role and clock', liveB.role === 'keeper' && liveB.deadline > 0);

const selfA = await sync(A, MID);
ok('A can see that its own half is in', selfA.json.live?.submitted === true,
   JSON.stringify(selfA.json.live));

console.log('\nIDEMPOTENCE');
const again = await api('/api/mp/kick', A, 'POST',
  { matchId: MID, kickIndex: 0, strike: { ...SWIPE, aimM: -2.6 } });
ok('a resubmitted strike is a duplicate, not a second kick', again.json.duplicate === true,
   JSON.stringify(again.json));

console.log('\nAUTHORITY');
const subB = await api('/api/mp/kick', B, 'POST', { matchId: MID, kickIndex: 0, dive: DIVE });
ok('the second half resolves the kick', subB.json.kick?.resolved === true, JSON.stringify(subB.json));
const served = subB.json.kick;
ok('the server names an outcome', typeof served.outcome === 'string', JSON.stringify(served));
const mine = simulate({ ...SWIPE, kickIndex: 0, matchSeed: SEED, difficulty: 'senior',
                        weather: dA.json.weather, dive: DIVE });
ok('and it is exactly what the client simulates from the same record',
   mine.outcome === served.outcome, mine.outcome + ' vs ' + served.outcome);
ok('the outcome the client claimed was ignored',
   served.value === (served.outcome === 'goal' ? 3 : served.outcome === 'twopoint' ? 2
                    : served.outcome === 'point' ? 1 : 0), JSON.stringify(served));

console.log('\nREPLAY — both screens show the same kick');
const rA = await sync(A, MID), rB = await sync(B, MID);
const kA = rA.json.played.find(k => k.kickIndex === 0);
const kB = rB.json.played.find(k => k.kickIndex === 0);
ok('a resolved kick is public to both', !!kA && !!kB);
ok('both are given both halves',
   JSON.stringify(kA.strike) === JSON.stringify(kB.strike) &&
   JSON.stringify(kA.dive) === JSON.stringify(kB.dive), JSON.stringify([kA, kB]));
ok('the swipe survives intact', kA.strike.power === SWIPE.power && kA.strike.aimM === SWIPE.aimM,
   JSON.stringify(kA.strike));
ok('and the fields the client made up were never stored at all',
   kA.strike.outcome === undefined && kA.strike.value === undefined && kA.strike.xp === undefined,
   JSON.stringify(kA.strike));
ok('and both are told the same outcome', kA.outcome === kB.outcome);
ok('kick 1 opened, with the sides swapped',
   rA.json.live?.kickIndex === 1 && rA.json.live?.role === 'keeper' &&
   rB.json.live?.role === 'striker', JSON.stringify([rA.json.live, rB.json.live]));
ok('the scoreboard is oriented to the reader',
   rA.json.score.you === rA.json.scores.a && rB.json.score.you === rB.json.scores.b,
   JSON.stringify([rA.json.score, rA.json.scores]));

console.log('\nHOLDING YOUR LINE');
// A is the keeper on kick 1. An explicit null dive is a decision, not silence.
const held = await api('/api/mp/kick', A, 'POST', { matchId: MID, kickIndex: 1, dive: null });
ok('a keeper may decide not to go', held.status === 200 && held.json.accepted,
   JSON.stringify(held.json));
const stillLive = await sync(A, MID);
ok('and that counts as submitted', stillLive.json.live?.submitted === true,
   JSON.stringify(stillLive.json.live));
const subB1 = await api('/api/mp/kick', B, 'POST', { matchId: MID, kickIndex: 1, strike: SWIPE });
ok('the striker then resolves it', subB1.json.kick?.resolved === true, JSON.stringify(subB1.json));

console.log('\nSETTLEMENT');
const fin1 = await sync(A, MID);
ok('the match is settled once every kick is decided', fin1.json.state === 'settled',
   JSON.stringify({ state: fin1.json.state, played: fin1.json.played.length }));
ok('both kicks are on the record', fin1.json.played.length === 2);
const money1 = fin1.json.you.money;
await sync(A, MID); await sync(B, MID);
const fin2 = await sync(A, MID);
ok('polling again does not pay out again', fin2.json.you.money === money1,
   money1 + ' -> ' + fin2.json.you.money);
const late = await api('/api/mp/kick', A, 'POST', { matchId: MID, kickIndex: 1, dive: DIVE });
ok('and a kick cannot be submitted into a finished match', late.status === 409,
   JSON.stringify(late.json));

console.log('\nLIVENESS — a player who walks away loses the kick');
const wA = await api('/api/mp/duel', A, 'POST', { kicks: 2, turnMs: 8000, join: false });
const wB = await api('/api/mp/duel', B, 'POST', { matchId: wA.json.matchId });
ok('a blitz duel pairs up', wA.json.matchId === wB.json.matchId, JSON.stringify([wA.json, wB.json]));
const WID = wA.json.matchId;
await ready(A, WID); await ready(B, WID);
const w0 = await sync(A, WID);
const wait = Math.max(0, w0.json.live.deadline - w0.json.serverTime) + 2;
console.log('  ..  waiting ' + wait + 's for the deadline');
await new Promise(r => setTimeout(r, wait * 1000));
const after = await sync(A, WID);
const timedOut = after.json.played.find(k => k.kickIndex === 0);
ok('the abandoned kick resolved on its own', !!timedOut, JSON.stringify(after.json.played));
ok('nobody took it, so it scored nothing',
   timedOut?.outcome === 'timeout' && timedOut?.value === 0, JSON.stringify(timedOut));
ok('and the match moved on rather than freezing', after.json.live?.kickIndex === 1,
   JSON.stringify(after.json.live));

console.log('\n' + (fail ? 'DUEL API: ' + fail + ' FAILED' : 'DUEL API: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
