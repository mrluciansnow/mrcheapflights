// POST /api/mp/match — create a match, or join one that is waiting.
// The seed is issued here and never leaves the server's control: every
// condition in the match (wind, weather, ground, keeper behaviour) derives
// from it, so neither client can shop for favourable conditions.
import { resolvePlayer, bad, now, publicPlayer } from '../../_lib/mp.js';
import { randomHex } from '../../_lib/auth.js';
import { DIFF } from '../../_lib/sim.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const me = await resolvePlayer(env, request);
  if (!me) return bad('device token required', 401);

  let body = {};
  try { body = await request.json(); } catch { /* defaults */ }
  const rounds = Math.min(Math.max(parseInt(body.rounds, 10) || 5, 1), 10);
  const difficulty = DIFF[body.difficulty] ? body.difficulty : 'senior';

  // join an open match first, so a queue of one drains before a new one opens
  if (body.join !== false) {
    const open = await env.DB.prepare(
      `SELECT * FROM cf_matches
        WHERE state = 'waiting' AND a_player != ? AND b_player IS NULL
        ORDER BY created_at ASC LIMIT 1`
    ).bind(me.id).first();
    if (open) {
      const res = await env.DB.prepare(
        `UPDATE cf_matches SET b_player = ?, state = 'in_progress', updated_at = ?
          WHERE id = ? AND state = 'waiting' AND b_player IS NULL`
      ).bind(me.id, now(), open.id).run();
      // if another player won the race, fall through and open our own
      if (res.meta.changes === 1) {
        return Response.json({
          matchId: open.id, seed: open.seed, rounds: open.rounds,
          difficulty: open.difficulty, state: 'in_progress',
          you: publicPlayer(me), role: 'b',
        });
      }
    }
  }

  const id = 'm_' + randomHex(10);
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO cf_matches (id, seed, mode, rounds, difficulty, a_player, state, created_at, updated_at)
     VALUES (?, ?, 'shootout', ?, ?, ?, 'waiting', ?, ?)`
  ).bind(id, seed[0], rounds, difficulty, me.id, t, t).run();

  return Response.json({
    matchId: id, seed: seed[0], rounds, difficulty,
    state: 'waiting', you: publicPlayer(me), role: 'a',
  });
}
