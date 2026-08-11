/* Global matchmaking: two strangers press FIND and end up in one match.
 *
 *   npx wrangler pages dev . --port 8788
 *   node tests/duel-queue.mjs
 *
 * The lobby suite proves the friend-code path. This proves the anonymous one,
 * and specifically the three ways a queue goes wrong once real people are on
 * it rather than a scripted pair:
 *
 *   THE RACE  two players press Find in the same instant, both look, both find
 *             nothing, both open a lobby — and with exactly two people online
 *             that deadlocks forever unless something breaks the tie
 *   GHOSTS    a lobby whose host closed the tab must not be handed to the next
 *             player, who would otherwise spend a match watching timeouts
 *   FAIRNESS  the queue serves whoever has waited longest, not most recently
 */
const BASE = process.env.MP_BASE || 'http://localhost:8788';
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const dev = who => 'device-q-' + who + '-' + RUN + '0'.repeat(20);

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
const find = d => api('/api/mp/duel', d, 'POST', { kicks: 2 });
const sync = (d, id) => api('/api/mp/sync/' + id, d);

/* Follow the queue wherever it puts you, the way the client does. */
async function settleInto(d, id, hops = 6) {
  let at = id;
  for (let i = 0; i < hops; i++) {
    const s = await sync(d, at);
    if (s.json.movedTo) { at = s.json.movedTo; continue; }
    return { at, state: s.json.state, json: s.json };
  }
  return { at, state: 'stuck' };
}

console.log('\nTHE RACE — both press FIND at the same instant');
const A = dev('a'), B = dev('b');
const [rA, rB] = await Promise.all([find(A), find(B)]);
ok('both got a match back', rA.status === 200 && rB.status === 200);
const paired = rA.json.matchId === rB.json.matchId;
console.log('  ..  ' + (paired
  ? 'paired outright (one saw the other\'s lobby)'
  : 'both opened a lobby — the tie has to be broken'));

// whichever way it went, one poll each has to converge them
const fA = await settleInto(A, rA.json.matchId);
const fB = await settleInto(B, rB.json.matchId);
ok('A ends up in a live match', fA.state === 'in_progress', JSON.stringify(fA.state));
ok('B ends up in a live match', fB.state === 'in_progress', JSON.stringify(fB.state));
ok('and it is the SAME match — the race cannot deadlock', fA.at === fB.at,
   fA.at + ' vs ' + fB.at);
ok('they are on opposite sides', fA.json.side !== fB.json.side,
   fA.json.side + ' / ' + fB.json.side);

console.log('\nTHE DEADLOCK, FORCED — two hosts, neither joining');
/* The race above may pair outright depending on timing, which does not
   exercise the tie-break at all. This creates the bad state on purpose: two
   players each holding their own lobby, each waiting for the other. */
const G = dev('g'), H = dev('h');
const lobbyG = await api('/api/mp/duel', G, 'POST', { kicks: 2, join: false });
await new Promise(r => setTimeout(r, 1100));
const lobbyH = await api('/api/mp/duel', H, 'POST', { kicks: 2, join: false });
ok('two separate lobbies exist', lobbyG.json.matchId !== lobbyH.json.matchId);
ok('and both are waiting on nobody',
   lobbyG.json.state === 'waiting' && lobbyH.json.state === 'waiting');

// the NEWER host polls: they are the one who should give way
const moved = await sync(H, lobbyH.json.matchId);
ok('the newer host is moved into the older lobby', moved.json.movedTo === lobbyG.json.matchId,
   JSON.stringify(moved.json).slice(0, 160));
const gAfter = await sync(G, lobbyG.json.matchId);
ok('which is now a live match', gAfter.json.state === 'in_progress',
   JSON.stringify(gAfter.json.state));
const hAfter = await sync(H, moved.json.movedTo);
ok('with both players in it', hAfter.json.state === 'in_progress' &&
   gAfter.json.side !== hAfter.json.side, gAfter.json.side + ' / ' + hAfter.json.side);
const abandoned = await sync(H, lobbyH.json.matchId);
ok('and the lobby that gave way is retired, not left for somebody to join',
   abandoned.json.state === 'expired', JSON.stringify(abandoned.json.state));

console.log('\nFAIRNESS — the front of the queue is served first');
const C = dev('c'), D = dev('d'), E = dev('e');
const first = await api('/api/mp/duel', C, 'POST', { kicks: 2, join: false });
await new Promise(r => setTimeout(r, 1100));           // a clearly later lobby
const second = await api('/api/mp/duel', D, 'POST', { kicks: 2, join: false });
const joiner = await find(E);
ok('the joiner took the lobby that had been waiting longest',
   joiner.json.matchId === first.json.matchId,
   'got ' + joiner.json.matchId + ', oldest was ' + first.json.matchId);
ok('and the newer one is still waiting its turn',
   (await sync(D, second.json.matchId)).json.state === 'waiting');

console.log('\nQUEUE DEPTH — the lobby can say what is happening');
const depth = (await sync(D, second.json.matchId)).json.queue;
ok('a waiting player is told how many are looking', typeof depth === 'number' && depth >= 1,
   String(depth));

console.log('\nGHOSTS — a lobby nobody is sitting in is not handed out');
/* `last_seen` is refreshed by every request, so a host who has stopped asking
   is exactly a host who has gone. Rather than sleep out the liveness window,
   age this one directly — the behaviour under test is the query, not the clock. */
const ghostHost = dev('ghost');
const ghost = await api('/api/mp/duel', ghostHost, 'POST', { kicks: 2, join: false });
ok('the ghost opened a lobby', ghost.json.state === 'waiting');

/* Rather than sleep out the liveness window — or, worse, ship an endpoint that
   backdates a timestamp so a test can use it — age the row directly. That is
   only possible against the local database, so this section runs locally and
   says so when it cannot. */
const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
if (!local) {
  console.log('  ..  skipped against a remote deployment: needs direct DB access');
} else {
  const { execFileSync } = await import('node:child_process');
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'mrcheapflights-prod', '--local',
    '--command', "UPDATE cf_players SET last_seen = last_seen - 600 " +
                 "WHERE id = (SELECT a_player FROM cf_matches WHERE id = '" +
                 ghost.json.matchId.replace(/'/g, "") + "')"],
    { stdio: 'ignore' });

  const F = dev('f');
  const after = await find(F);
  ok('a fresh player is NOT given the abandoned lobby',
     after.json.matchId !== ghost.json.matchId,
     'got ' + after.json.matchId + ', ghost was ' + ghost.json.matchId);
  const gone = await sync(ghostHost, ghost.json.matchId);
  ok('and the abandoned lobby is swept away',
     gone.json.state === 'expired', JSON.stringify(gone.json.state));
}

console.log('\nA DEPLOYMENT BEHIND ON ITS MIGRATIONS');
/* cf_duel_codes arrived later than the rest of the duel schema, so a site that
   has deployed new code without re-running migrations does not have it. That
   must cost you the five-character code and nothing else — unguarded, it took
   the whole of online down, because every poll of sync read that table. */
if (!local) {
  console.log('  ..  skipped against a remote deployment: needs direct DB access');
} else {
  const { execFileSync } = await import('node:child_process');
  const d1 = sql => execFileSync('npx',
    ['wrangler', 'd1', 'execute', 'mrcheapflights-prod', '--local', '--command', sql],
    { stdio: 'ignore' });
  d1('DROP TABLE IF EXISTS cf_duel_codes');
  try {
    const P = dev('p'), Q = dev('q');
    const hosted = await api('/api/mp/duel', P, 'POST', { kicks: 2, join: false });
    ok('a duel still opens without the codes table', hosted.status === 200,
       JSON.stringify(hosted.json).slice(0, 140));
    ok('it simply has no code to share', hosted.json.code === null || hosted.json.code === undefined,
       JSON.stringify(hosted.json.code));
    const found = await find(Q);
    ok('and FIND AN OPPONENT still pairs', found.status === 200 &&
       found.json.matchId === hosted.json.matchId,
       JSON.stringify(found.json).slice(0, 140));
    const s1 = await sync(P, hosted.json.matchId);
    ok('sync does not throw — this is what took online down',
       s1.status === 200 && s1.json.state === 'in_progress', JSON.stringify(s1.status));
    const health = await api('/api/mp/health', P);
    ok('and health says the migrations are behind rather than ok',
       health.status === 503 && (health.json.missing || []).includes('cf_duel_codes'),
       JSON.stringify({ status: health.status, missing: health.json.missing }));
  } finally {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'mrcheapflights-prod', '--local',
      '--file', 'migrations/0033_duel_code.sql'], { stdio: 'ignore' });
  }
}

console.log('\n' + (fail ? 'DUEL QUEUE: ' + fail + ' FAILED' : 'DUEL QUEUE: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
