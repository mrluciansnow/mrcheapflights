// POST /api/mp/kick — submit your half of one kick.
//
// You send what you did. Which half it is, is decided by the server from the
// kick's roles, not by the body — so a client cannot submit a dive against a
// kick it is supposed to be taking. The other half is never returned here,
// however many times you ask.
//
//   { matchId, kickIndex, strike: {power, aimM, curl, elev, x, z, wall} }
//   { matchId, kickIndex, dive:   {x, y, at} | null }
//
// A null dive is a real submission and means "I held my line". It is not the
// same as silence, which is what a deadline produces — though the two resolve
// the same way, deliberately, so timing out is never better than deciding.
import { resolvePlayer, bad, now } from '../../_lib/mp.js';
import { advance, getKick, resolveKick, viewKick, validateHalf, settle, ROOTED,
         pickStrike, pickDive } from '../../_lib/duel.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const me = await resolvePlayer(env, request);
  if (!me) return bad('device token required', 401);

  let body;
  try { body = await request.json(); } catch { return bad('bad json'); }
  const { matchId } = body || {};
  if (!matchId) return bad('matchId required');
  if (!Number.isInteger(body.kickIndex)) return bad('kickIndex required');

  const match = await env.DB.prepare('SELECT * FROM cf_matches WHERE id = ?')
    .bind(matchId).first();
  if (!match) return bad('no such match', 404);
  if (match.a_player !== me.id && match.b_player !== me.id) return bad('not your match', 403);
  const duel = await env.DB.prepare('SELECT * FROM cf_duels WHERE match_id = ?')
    .bind(matchId).first();
  if (!duel) return bad('not a duel', 409);
  if (match.state !== 'in_progress') return bad('match is ' + match.state, 409);

  // bring the match up to date first: a kick whose deadline passed while this
  // player was typing must not still be accepting submissions
  await advance(env, match, duel);

  const kick = await getKick(env, matchId, body.kickIndex);
  if (!kick) return bad('no such kick', 404);
  if (kick.resolved_at) return bad('kick already resolved', 409);

  const role = kick.striker === me.id ? 'striker'
             : kick.keeper === me.id ? 'keeper' : null;
  if (!role) return bad('not your kick', 403);

  // The body may carry both keys; only the one matching your role is read.
  const payload = role === 'striker' ? body.strike
                : (body.dive === undefined ? undefined : body.dive);
  if (payload === undefined) return bad('missing ' + (role === 'striker' ? 'strike' : 'dive'));
  const why = validateHalf(role, payload);
  if (why) return bad('invalid ' + role + ': ' + why);

  /* "I held my line" is stored as the rooted dive rather than as SQL NULL.
     NULL is how the table spells "nothing arrived", and the two have to stay
     distinguishable: a decision to stand still must register as a submission,
     so the kick resolves immediately instead of sitting on its deadline. They
     resolve to the same keeper — a man on his line — but only one of them
     means the player is still there. */
  const stored = role === 'striker' ? pickStrike(payload)
               : payload === null ? { held: true } : pickDive(payload);

  // Write once. The guard is what makes a retry idempotent rather than a
  // second, different kick: whoever got there first keeps the submission.
  // `col`/`stamp` come from a fixed ternary, never from the body.
  const col = role === 'striker' ? 'strike' : 'dive';
  const stamp = role === 'striker' ? 'strike_at' : 'dive_at';
  const res = await env.DB.prepare(
    `UPDATE cf_kicks SET ${col} = ?, ${stamp} = ?
      WHERE match_id = ? AND kick_index = ? AND ${col} IS NULL AND resolved_at IS NULL`
  ).bind(JSON.stringify(stored), now(), matchId, body.kickIndex).run();

  const already = res.meta.changes !== 1;

  // If that completed the pair, decide it now rather than making somebody
  // poll for a result that is already knowable.
  let after = await getKick(env, matchId, body.kickIndex);
  after = await resolveKick(env, match, duel, after);
  const outcome = await settle(env, match, duel);

  return Response.json({
    accepted: !already,
    duplicate: already,
    kick: viewKick(after, me.id),
    matchOver: !!outcome,
  });
}
