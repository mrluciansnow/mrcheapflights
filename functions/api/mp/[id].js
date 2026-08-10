// GET /api/mp/[id] — poll a match: whose turn, both scorelines, and whether
// it has resolved. Settlement runs here so it happens exactly once, guarded by
// the ledger's unique index.
import { resolvePlayer, bad, now, credit, publicPlayer } from '../../_lib/mp.js';

const PURSE_WIN = 250, PURSE_PLAY = 60;

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const me = await resolvePlayer(env, request);
  if (!me) return bad('device token required', 401);

  const match = await env.DB.prepare('SELECT * FROM cf_matches WHERE id = ?')
    .bind(params.id).first();
  if (!match) return bad('no such match', 404);
  if (match.a_player !== me.id && match.b_player !== me.id) return bad('not your match', 403);

  const turns = await env.DB.prepare(
    'SELECT player_id, kick_index, outcome, value FROM cf_turns WHERE match_id = ? ORDER BY kick_index'
  ).bind(params.id).all();

  const tally = id => turns.results.filter(t => t.player_id === id)
                                   .reduce((a, t) => a + t.value, 0);
  const taken = id => turns.results.filter(t => t.player_id === id).length;

  const aScore = tally(match.a_player), bScore = match.b_player ? tally(match.b_player) : 0;
  const done = match.b_player &&
               taken(match.a_player) >= match.rounds &&
               taken(match.b_player) >= match.rounds;

  let state = match.state, winner = match.winner;
  if (done && state === 'in_progress') {
    winner = aScore === bScore ? null : (aScore > bScore ? match.a_player : match.b_player);
    await env.DB.prepare(
      `UPDATE cf_matches SET state = 'resolved', winner = ?, updated_at = ? WHERE id = ?`
    ).bind(winner, now(), params.id).run();
    state = 'resolved';
  }
  if (state === 'resolved') {
    for (const pid of [match.a_player, match.b_player]) {
      if (!pid) continue;
      await credit(env, pid, PURSE_PLAY + (pid === winner ? PURSE_WIN : 0), 'match', params.id);
    }
    await env.DB.prepare(`UPDATE cf_matches SET state = 'settled' WHERE id = ?`)
      .bind(params.id).run();
    state = 'settled';
  }

  const fresh = await env.DB.prepare('SELECT * FROM cf_players WHERE id = ?').bind(me.id).first();
  return Response.json({
    matchId: match.id, seed: match.seed, rounds: match.rounds,
    difficulty: match.difficulty, state, winner,
    yourRole: match.a_player === me.id ? 'a' : 'b',
    yourKicks: taken(me.id),
    scores: { a: aScore, b: bScore },
    kicksTaken: { a: taken(match.a_player), b: match.b_player ? taken(match.b_player) : 0 },
    turns: turns.results,
    you: publicPlayer(fresh),
  });
}
