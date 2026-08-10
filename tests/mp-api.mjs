/* End-to-end test of the multiplayer API against a local Pages dev server.
 *
 *   npx wrangler d1 execute mrcheapflights-prod --local --file=migrations/0031_multiplayer.sql
 *   npx wrangler pages dev . --port 8788 --d1 DB=mrcheapflights-prod
 *   node tests/mp-api.mjs
 *
 * Covers: anonymous device accounts, create/join, in-order kicks, server-side
 * re-simulation, idempotent retries, tampering rejection, and one-time
 * settlement.
 */
const BASE = process.env.MP_BASE || 'http://localhost:8788';
const A = 'device-aaaa-' + '0'.repeat(20);
const B = 'device-bbbb-' + '0'.repeat(20);

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => {
  if(cond){ pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

async function api(path, device, method='GET', body){
  const r = await fetch(BASE + path, {
    method,
    headers: {'X-CF-Device': device, 'Content-Type':'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(()=>({})) };
}
const kick = (i, over) => Object.assign({
  kickIndex:i, power:0.5, aimM:2.6, curl:0.3, x:0, z:11, wall:0, weather:0,
}, over||{});

console.log('\nAUTH');
const noDev = await fetch(BASE + '/api/mp/match', {method:'POST'});
ok('no device token is rejected', noDev.status === 401);

console.log('\nMATCHMAKING');
const mA = await api('/api/mp/match', A, 'POST', {rounds:3, difficulty:'senior'});
ok('player A opens a match', mA.status===200 && mA.json.state==='waiting', JSON.stringify(mA.json));
ok('server issues the seed', typeof mA.json.seed === 'number');
const mB = await api('/api/mp/match', B, 'POST', {rounds:3});
ok('player B joins the waiting match', mB.json.matchId === mA.json.matchId && mB.json.state==='in_progress',
   JSON.stringify(mB.json));
ok('both are told the same seed', mB.json.seed === mA.json.seed);
const MID = mA.json.matchId;

console.log('\nVALIDATION');
const badPow = await api('/api/mp/turn', A, 'POST', {matchId:MID, record:kick(0,{power:9})});
ok('out-of-range power rejected', badPow.status===400, JSON.stringify(badPow.json));
const badAim = await api('/api/mp/turn', A, 'POST', {matchId:MID, record:kick(0,{aimM:99})});
ok('out-of-range aim rejected', badAim.status===400);
const skip = await api('/api/mp/turn', A, 'POST', {matchId:MID, record:kick(2)});
ok('out-of-order kick rejected', skip.status===409, JSON.stringify(skip.json));

console.log('\nSERVER-SIDE OUTCOME');
const t0 = await api('/api/mp/turn', A, 'POST', {matchId:MID, record:kick(0)});
ok('turn accepted and scored by the server', t0.status===200 && typeof t0.json.outcome==='string',
   JSON.stringify(t0.json));
const claimed = await api('/api/mp/turn', A, 'POST', {matchId:MID,
  record:Object.assign(kick(1), {outcome:'goal', value:3, xp:99999})});
ok('client-claimed outcome is ignored', claimed.status===200 && claimed.json.xp !== 99999,
   JSON.stringify(claimed.json));
const dupe = await api('/api/mp/turn', A, 'POST', {matchId:MID, record:kick(1)});
ok('replayed kick index is refused', dupe.status===409);

console.log('\nSEED AUTHORITY');
const spoof = await api('/api/mp/turn', A, 'POST', {matchId:MID,
  record:Object.assign(kick(2), {matchSeed: 1})});
ok('client-supplied seed does not change the match', spoof.status===200);
const stateA = await api('/api/mp/' + MID, A);
const storedSeed = stateA.json.seed;
ok('match seed unchanged after spoof attempt', storedSeed === mA.json.seed);

console.log('\nISOLATION');
const C = 'device-cccc-' + '0'.repeat(20);
await api('/api/mp/match', C, 'POST', {join:false});
const nosy = await api('/api/mp/' + MID, C);
ok('a third player cannot read the match', nosy.status===403);

console.log('\nSETTLEMENT');
for(let i=0;i<3;i++) await api('/api/mp/turn', B, 'POST', {matchId:MID, record:kick(i)});
const fin = await api('/api/mp/' + MID, A);
ok('match resolves once both have finished', fin.json.state==='settled', JSON.stringify(fin.json.state));
ok('scores are server-computed', typeof fin.json.scores.a === 'number' && typeof fin.json.scores.b === 'number');
const bal1 = fin.json.you.money;
const again = await api('/api/mp/' + MID, A);
ok('polling again does not pay twice', again.json.you.money === bal1,
   bal1 + ' -> ' + again.json.you.money);
const closed = await api('/api/mp/turn', A, 'POST', {matchId:MID, record:kick(3)});
ok('no kicks accepted after settlement', closed.status===409);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
