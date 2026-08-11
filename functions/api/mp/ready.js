// POST /api/mp/ready — "I am here."
//
// A duel used to start the instant the queue paired two strangers. The first
// kick opened with its deadline already running, in front of somebody still
// reading the word FOUND, and a kick with a running deadline is a kick you can
// lose without touching the screen.
//
// So both players say when they are ready, and nothing opens until both have.
// It is idempotent: the primary key on (match, player) means a double-tap is
// the same as a tap, and a client that retries after a dropped connection is
// doing the right thing.
//
//   { matchId }  ->  { ready: {you, them, both}, state }
import { resolvePlayer, bad } from '../../_lib/mp.js';
import { markReady, readyState, advance } from '../../_lib/duel.js';

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
  const duel = await env.DB.prepare('SELECT * FROM cf_duels WHERE match_id = ?')
    .bind(matchId).first();
  if (!duel) return bad('not a duel', 409);

  await markReady(env, matchId, me.id);

  /* Say it and start it in one round trip. Whoever is second to press READY
     opens the first kick by pressing it, rather than by polling afterwards —
     which is a poll interval of dead air on the screen that matters most. */
  const ready = await readyState(env, match);
  if (ready.both && match.state === 'in_progress') await advance(env, match, duel);

  return Response.json({
    ready: {
      you: match.a_player === me.id ? ready.a : ready.b,
      them: match.a_player === me.id ? ready.b : ready.a,
      both: ready.both,
    },
    state: match.state,
  });
}
