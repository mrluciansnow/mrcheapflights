// POST /api/mp/again — "same again?"
//
// A finished match had no way back other than the main menu and the queue,
// which is a long way round for the most likely thing anybody wants to do
// next. Both have to want it: the second request to arrive creates the new
// duel and writes its id onto both rows, so the first player picks it up on
// their next sync rather than being told to ask again.
//
// Sides swap. A rematch that put the same person on the ball first would be
// the same match twice.
import { resolvePlayer, bad } from '../../_lib/mp.js';
import { markAgain, againState, makeAgain } from '../../_lib/duel.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const me = await resolvePlayer(env, request);
  if (!me) return bad('device token required', 401);

  let body;
  try { body = await request.json(); } catch { return bad('bad json'); }
  const matchId = body && body.matchId;
  if (!matchId) return bad('matchId required');

  const match = await env.DB.prepare('SELECT * FROM cf_matches WHERE id = ?')
    .bind(matchId).first();
  if (!match) return bad('no such match', 404);
  if (match.a_player !== me.id && match.b_player !== me.id) return bad('not your match', 403);
  if (!match.b_player) return bad('nobody to play again', 409);
  /* The match has to be OVER. Without this a player could ask mid-match and
     get handed a second, live duel against the same person — two matches, two
     shot clocks, one pair of thumbs — and the one they were already in would
     run down its deadlines while they were somewhere else. */
  if (match.state !== 'settled' && match.state !== 'resolved')
    return bad('that match is still going', 409);
  const duel = await env.DB.prepare('SELECT * FROM cf_duels WHERE match_id = ?')
    .bind(matchId).first();
  if (!duel) return bad('not a duel', 409);

  await markAgain(env, matchId, me.id);
  const next = await makeAgain(env, match, duel, me.id);
  const st = await againState(env, match, me.id);

  return Response.json({
    again: { you: st.you, them: st.them },
    matchId: next || null,      // null until both have asked
  });
}
