// POST /api/mp/duel — open a duel, or join one that is waiting.
//
// Same matchmaking shape as /api/mp/match, but the match it produces is a
// duel: kicks alternate, and every kick has a striker and a keeper who both
// submit blind. A match is a duel if and only if it carries a cf_duels row.
import { resolvePlayer, bad, now, publicPlayer } from '../../_lib/mp.js';
import { randomHex } from '../../_lib/auth.js';
import { DIFF, WEATHERS } from '../../_lib/sim.js';
import { openKick, sideOf, assignCode, codeFor, matchForCode } from '../../_lib/duel.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const me = await resolvePlayer(env, request);
  if (!me) return bad('device token required', 401);

  let body = {};
  try { body = await request.json(); } catch { /* defaults */ }
  // even, so neither player gets an extra kick
  let kicks = Math.min(Math.max(parseInt(body.kicks, 10) || 10, 2), 20);
  if (kicks % 2) kicks++;
  const turnMs = Math.min(Math.max(parseInt(body.turnMs, 10) || 25000, 8000), 120000);
  const difficulty = DIFF[body.difficulty] ? body.difficulty : 'senior';

  /* Three ways in, and they are the same code path:
       { matchId }      join that match and no other — a friend's lobby, or a
                        rematch. Fails rather than silently pairing you with a
                        stranger, because "play Sean" and "play anyone" are
                        different requests.
       { join: false }  open a lobby and wait; do not take an open one.
       (neither)        take an open lobby if there is one, else open your own. */
  /* A code is just a friendlier way of naming a match, so it is resolved to
     one before anything else looks at the request. */
  if (body.code && !body.matchId) {
    const hit = await matchForCode(env, body.code);
    if (!hit) return bad('no game with that code — check it and try again', 404);
    body.matchId = hit.match_id;
  }

  if (body.matchId || body.join !== false) {
    const fresh = now() - 15 * 60;
    const open = body.matchId
      ? await env.DB.prepare(
          `SELECT m.* FROM cf_matches m
             JOIN cf_duels d ON d.match_id = m.id
            WHERE m.id = ? AND m.state = 'waiting' AND m.a_player != ? AND m.b_player IS NULL`
        ).bind(String(body.matchId), me.id).first()
      : await env.DB.prepare(
          `SELECT m.* FROM cf_matches m
             JOIN cf_duels d ON d.match_id = m.id
            WHERE m.state = 'waiting' AND m.a_player != ? AND m.b_player IS NULL
              AND m.created_at > ?
            ORDER BY m.created_at DESC LIMIT 1`
        ).bind(me.id, fresh).first();
    if (body.matchId && !open) return bad('that duel is not open to join', 409);
    if (open) {
      const res = await env.DB.prepare(
        `UPDATE cf_matches SET b_player = ?, state = 'in_progress', updated_at = ?
          WHERE id = ? AND state = 'waiting' AND b_player IS NULL`
      ).bind(me.id, now(), open.id).run();
      if (res.meta.changes === 1) {
        const match = { ...open, b_player: me.id, state: 'in_progress' };
        const duel = await env.DB.prepare('SELECT * FROM cf_duels WHERE match_id = ?')
          .bind(open.id).first();
        // the first kick opens now, so its deadline starts when both players
        // are actually present rather than when the lobby was created
        await openKick(env, match, duel, duel.kick_index);
        const c = await codeFor(env, open.id);
        return Response.json({
          matchId: open.id, code: c ? c.code : null,
          seed: open.seed >>> 0, kicks: duel.kicks,
          turnMs: duel.turn_ms, difficulty: open.difficulty, weather: duel.weather,
          state: 'in_progress', you: publicPlayer(me), side: sideOf(match, me.id),
        });
      }
    }
  }

  const id = 'm_' + randomHex(10);
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  // drawn from the seed, so it is the match's condition rather than a setting
  const weather = seed[0] % WEATHERS.length;
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO cf_matches (id, seed, mode, rounds, difficulty, a_player, state, created_at, updated_at)
       VALUES (?, ?, 'duel', ?, ?, ?, 'waiting', ?, ?)`
    ).bind(id, seed[0], kicks, difficulty, me.id, t, t),
    env.DB.prepare(
      `INSERT INTO cf_duels (match_id, kicks, kick_index, turn_ms, weather, created_at)
       VALUES (?, ?, 0, ?, ?, ?)`
    ).bind(id, kicks, turnMs, weather, t),
  ]);

  const code = await assignCode(env, id);
  return Response.json({
    matchId: id, code, seed: seed[0], kicks, turnMs, difficulty, weather,
    state: 'waiting', you: publicPlayer(me), side: 'a',
  });
}
