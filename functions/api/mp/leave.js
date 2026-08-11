// POST /api/mp/leave — "I am going."
//
// Closing the tab used to cost the other player the rest of the match in
// twenty-five-second silences, one per remaining kick, with nothing on screen
// to say why. This ends it at once, on the score as it stands.
//
// Deliberately NOT a forfeit. A dropped connection and a walk-out look
// identical from here, and only one of them deserves a penalty — so the rule
// is the plain one: whatever the score was, that is the result. If you were
// ahead when they went, you win; if you were behind, you were behind.
//
// Sent with keepalive from a page that is in the middle of closing, so it has
// to be idempotent and it has to be cheap.
import { resolvePlayer, bad } from '../../_lib/mp.js';
import { markGone, abandon } from '../../_lib/duel.js';

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

  await markGone(env, matchId, me.id);

  const duel = await env.DB.prepare('SELECT * FROM cf_duels WHERE match_id = ?')
    .bind(matchId).first();
  /* A lobby nobody joined is retired rather than settled: there is no match to
     score and no opponent to tell. */
  if (match.state === 'waiting') {
    await env.DB.prepare(
      `UPDATE cf_matches SET state = 'expired' WHERE id = ? AND state = 'waiting'`
    ).bind(matchId).run();
    return Response.json({ left: true, state: 'expired' });
  }
  if (duel && match.state === 'in_progress') await abandon(env, match, duel);

  return Response.json({ left: true, state: 'settled' });
}
