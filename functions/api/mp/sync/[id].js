// GET /api/mp/sync/[id] — the whole state of a duel, as this player is
// allowed to see it.
//
// This is the client's only read. It answers three questions:
//   what am I doing right now, how long have I got, and what has already
//   happened — and it answers the third with both players' inputs, because a
// resolved kick is public and both clients replay it from exactly these
// numbers to show exactly the same thing.
//
// What it never answers is what the opponent has done on the kick in front of
// you. That redaction lives in `viewKick` and it is the whole game: without
// it, the keeper waits for the swipe to land and saves everything.
import { resolvePlayer, bad, publicPlayer, now } from '../../../_lib/mp.js';
import { advance, viewKick, tally, settle, sideOf, codeFor } from '../../../_lib/duel.js';

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const me = await resolvePlayer(env, request);
  if (!me) return bad('device token required', 401);

  const match = await env.DB.prepare('SELECT * FROM cf_matches WHERE id = ?')
    .bind(params.id).first();
  if (!match) return bad('no such match', 404);
  if (match.a_player !== me.id && match.b_player !== me.id) return bad('not your match', 403);
  const duel = await env.DB.prepare('SELECT * FROM cf_duels WHERE match_id = ?')
    .bind(params.id).first();
  if (!duel) return bad('not a duel', 409);

  // Every read advances the match. A duel therefore cannot stall waiting on a
  // background job: whichever player is looking pushes it along, and if
  // neither is looking there is nobody for it to stall.
  const live = match.state === 'in_progress' ? await advance(env, match, duel) : null;
  await settle(env, match, duel);

  const fresh = await env.DB.prepare('SELECT * FROM cf_matches WHERE id = ?')
    .bind(params.id).first();
  const kicks = await env.DB.prepare(
    `SELECT * FROM cf_kicks WHERE match_id = ? AND resolved_at IS NOT NULL
      ORDER BY kick_index`
  ).bind(params.id).all();
  const scores = await tally(env, fresh);
  const mySide = sideOf(fresh, me.id);

  const played = kicks.results.map(k => {
    const v = viewKick(k, me.id);
    v.strikerSide = sideOf(fresh, k.striker);
    return v;
  });

  const player = await env.DB.prepare('SELECT * FROM cf_players WHERE id = ?')
    .bind(me.id).first();

  const c = await codeFor(env, params.id);
  return Response.json({
    matchId: fresh.id,
    code: c ? c.code : null,
    // the seed the client needs in order to reproduce conditions locally; it
    // is not a secret, it is just not the client's to choose
    seed: fresh.seed >>> 0,
    difficulty: fresh.difficulty,
    // the conditions both clients must play in; the server simulates in them
    // whatever the client thinks it is doing
    weather: duel.weather,
    kicks: duel.kicks,
    turnMs: duel.turn_ms,
    state: fresh.state,
    winner: fresh.winner,
    you: publicPlayer(player),
    side: mySide,
    scores,
    // your score first, so the HUD never has to work out which way round it is
    score: { you: scores[mySide], them: scores[mySide === 'a' ? 'b' : 'a'] },
    // the kick in front of you: your role, your deadline, and whether your own
    // half is already in. Never anything about theirs.
    live: live ? viewKick(live, me.id) : null,
    serverTime: now(),
    played,
  });
}
