// POST /api/mp/turn — submit one input record.
// The client sends what the player did, never what happened. The server
// re-runs the same deterministic simulation and the result it computes is the
// only result that is stored.
import { resolvePlayer, bad, now, addXp } from '../../_lib/mp.js';
import { simulate, validateRecord, scoreValue, xpValue } from '../../_lib/sim.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const me = await resolvePlayer(env, request);
  if (!me) return bad('device token required', 401);

  let body;
  try { body = await request.json(); } catch { return bad('bad json'); }
  const { matchId, record } = body || {};
  if (!matchId) return bad('matchId required');

  const why = validateRecord(record);
  if (why) return bad('invalid record: ' + why);

  const match = await env.DB.prepare('SELECT * FROM cf_matches WHERE id = ?')
    .bind(matchId).first();
  if (!match) return bad('no such match', 404);
  if (match.a_player !== me.id && match.b_player !== me.id) return bad('not your match', 403);
  if (match.state !== 'in_progress') return bad('match is ' + match.state, 409);

  // kicks must arrive in order, and only as many as the match has rounds
  const played = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM cf_turns WHERE match_id = ? AND player_id = ?'
  ).bind(matchId, me.id).first();
  if (record.kickIndex !== played.n) return bad('expected kickIndex ' + played.n, 409);
  if (record.kickIndex >= match.rounds) return bad('all kicks taken', 409);

  // the seed is the server's, not the client's
  const authoritative = {
    ...record,
    matchSeed: match.seed >>> 0,
    difficulty: match.difficulty,
  };
  const result = simulate(authoritative);
  const value = scoreValue(result.outcome);

  const streak = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM cf_turns
      WHERE match_id = ? AND player_id = ? AND value > 0`
  ).bind(matchId, me.id).first();
  const xp = xpValue(result.outcome, authoritative, streak.n);

  try {
    await env.DB.prepare(
      `INSERT INTO cf_turns (match_id, player_id, kick_index, record, outcome, value, xp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(matchId, me.id, record.kickIndex, JSON.stringify(authoritative),
           result.outcome, value, xp, now()).run();
  } catch {
    return bad('kick already submitted', 409);   // idempotent on retry
  }
  await addXp(env, me.id, xp);
  await env.DB.prepare('UPDATE cf_matches SET updated_at = ? WHERE id = ?')
    .bind(now(), matchId).run();

  return Response.json({ outcome: result.outcome, value, xp, kickIndex: record.kickIndex });
}
