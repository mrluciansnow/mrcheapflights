/* ==========================================================================
   ONLINE DUELS — resolution
   ==========================================================================
   A kick is a duel: one striker, one keeper, both acting against the same
   clock, neither able to see the other's input before its own is in. The
   client already has that shape — `srcStriker` and `srcKeeper` are each
   'local' | 'ai' | 'remote' on one kick clock — and this is the server half
   of it.

   The whole protocol is three rules:

     1. The server owns the seed. Every condition in a kick (wind, weather,
        keeper reaction, contact slip) derives from `hash2(matchSeed, kickIndex)`,
        and the seed is issued here and never accepted from a client.
     2. The client sends what the player DID, never what happened. Both halves
        land in their own column, and the outcome is computed here by re-running
        the same deterministic simulation the client ran.
     3. Neither half is readable by the other player until the kick resolves.
        Blindness is a property of the redaction in `viewKick`, and it is the
        one thing that makes the duel a duel rather than a reaction test.

   Determinism is what lets all of that be cheap: the server does not stream a
   simulation to anybody. It stores four numbers and a dive, and both clients
   replay the identical kick from them.
   ========================================================================== */

import { simulate, validateRecord, scoreValue, xpValue, DIFF } from './sim.js';
import { now, credit, addXp } from './mp.js';

/* A keeper who never commits stands on his line — which is a legal, and
   sometimes correct, thing to do. `simulate` treats an absent dive as "play
   the AI keeper", so silence has to be spelled out rather than omitted, or a
   player who closes the tab would be handed a better keeper than one who
   deliberately held his ground.

   `at` is seconds relative to the strike. Beyond the flight time of any kick,
   the dive never begins and he never leaves his line — which is exactly the
   behaviour we want, expressed in the record shape that already exists. */
export const ROOTED = { x: 0, y: 1.35, at: 8 };

/* ---- the shared reference ----
 *
 * `dive.at` is seconds relative to the STRIKE, and it is the whole of the
 * keeper's timing game: negative means he had already gone. Offline that is
 * easy, because one machine watches both. Online it is not — the keeper
 * cannot know when the striker will hit it, and the striker cannot know when
 * the keeper left.
 *
 * So neither of them times against the other. Both time against the one
 * moment they share: the instant the kick opened, which the server stamped
 * and told them both. Each submits `t`, seconds after that, and the server
 * does the subtraction. The timing duel survives the wire without either
 * player ever being told anything about the other.
 */
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, +v || 0));
export function diveFor(strike, dive) {
  if (!dive || dive.held || typeof dive.t !== 'number') return ROOTED;
  const st = typeof strike.t === 'number' ? strike.t : 0;
  return { x: +dive.x, y: +dive.y, at: clampNum(dive.t - st, -8, 8) };
}

/* Store what we understand and nothing else.
 *
 * A submission is a physical action, and these are all the numbers an action
 * has. Anything else in the body — an `outcome` the client would like, an
 * `xp` figure, a field from a future version — is dropped here rather than
 * being written to a row that both players later read back. It was already
 * ignored for scoring; the point of the projection is that it never reaches
 * the database, and so never reaches the opponent's screen either. */
export const pickStrike = s => ({
  power: +s.power, aimM: +s.aimM,
  curl: s.curl === undefined ? 0 : +s.curl,
  elev: s.elev === undefined ? +s.power : +s.elev,
  x: s.x === undefined ? 0 : +s.x,
  z: s.z === undefined ? 11 : +s.z,
  wall: s.wall ? (s.wall | 0) : 0,
  // when he hit it, measured from the kick opening
  t: clampNum(s.t, 0, 120),
});
/* `held` is a decision and `t` is a dive. Offline callers may still send an
   `at` directly; it is carried so a single-player record replays unchanged. */
export const pickDive = d => (d && d.held) ? { held: true }
  : (d && typeof d.t === 'number') ? { x: +d.x, y: +d.y, t: clampNum(d.t, 0, 120) }
  : { x: +d.x, y: +d.y, at: clampNum(d.at, -8, 8) };

/* Sides alternate. Kick 0 is A striking at B, kick 1 is B striking at A, and
   so on — so an odd `kicks` count would hand somebody an extra kick, which is
   why the endpoint rounds it to even. */
export function roleFor(match, kickIndex) {
  const aStrikes = (kickIndex % 2) === 0;
  return {
    striker: aStrikes ? match.a_player : match.b_player,
    keeper:  aStrikes ? match.b_player : match.a_player,
  };
}

export const sideOf = (match, playerId) => (match.a_player === playerId ? 'a' : 'b');

/* No O/0 and no I/1: a code is read aloud and typed by somebody who did not
   choose it, so the glyphs that get confused are simply not in the alphabet. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;
function mintCode() {
  const n = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(n);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[n[i] % CODE_ALPHABET.length];
  return s;
}
/* Claim a code for a match. Collisions are rare and cheap — the primary key
   rejects the duplicate and we draw again. */
export async function assignCode(env, matchId) {
  for (let tries = 0; tries < 6; tries++) {
    const code = mintCode();
    try {
      await env.DB.prepare(
        'INSERT INTO cf_duel_codes (code, match_id, created_at) VALUES (?, ?, ?)'
      ).bind(code, matchId, now()).run();
      return code;
    } catch { /* taken — draw again */ }
  }
  return null;                                   // playable, just not shareable
}
/* ---- the queue ----
 *
 * "Find me anyone" is the whole of global matchmaking, and it has three ways
 * to go wrong that only show up with real strangers:
 *
 *   GHOSTS   somebody opens a lobby and closes the tab. Their row still says
 *            'waiting', so the next player joins a corpse and spends the match
 *            watching kicks time out. Every request refreshes `last_seen`, and
 *            a client polls every second or two, so a host who is still there
 *            is trivially distinguishable from one who is not — LIVE is the
 *            window that says so.
 *   THE RACE two people press Find in the same instant, both look, both find
 *            nothing, both open a lobby. Two lobbies, nobody paired, and with
 *            exactly two players online that is a permanent deadlock. Fixed by
 *            `mergeQueue` below rather than by hoping.
 *   FAIRNESS the queue was newest-first, so the person who had waited longest
 *            was served last. It is a queue; it is now oldest-first.
 */
export const LIVE = 45;          // seconds since a host's last request
export const STALE = 180;        // after this, their lobby is expired outright

export const openLobby = (env, meId) => env.DB.prepare(
  `SELECT m.* FROM cf_matches m
     JOIN cf_duels d ON d.match_id = m.id
     JOIN cf_players p ON p.id = m.a_player
    WHERE m.state = 'waiting' AND m.b_player IS NULL AND m.a_player != ?
      AND p.last_seen > ?
    ORDER BY m.created_at ASC LIMIT 1`
).bind(meId, now() - LIVE).first();

/* How many people are actually looking right now, so the lobby can say so
   instead of leaving you staring at a spinner wondering if it is broken. */
export const queueDepth = env => env.DB.prepare(
  `SELECT COUNT(*) AS n FROM cf_matches m
     JOIN cf_duels d ON d.match_id = m.id
     JOIN cf_players p ON p.id = m.a_player
    WHERE m.state = 'waiting' AND m.b_player IS NULL AND p.last_seen > ?`
).bind(now() - LIVE).first();

/* Sweep lobbies nobody came back to. Cheap, and it runs on the same polls
   that would otherwise have to trip over them. */
export const sweepLobbies = env => env.DB.prepare(
  `UPDATE cf_matches SET state = 'expired', updated_at = ?
    WHERE state = 'waiting' AND b_player IS NULL
      AND a_player IN (SELECT id FROM cf_players WHERE last_seen < ?)`
).bind(now(), now() - STALE).run();

/* Two hosts, both waiting, neither joining: the race resolved.
 *
 * While you sit in your own lobby you keep asking whether somebody OLDER is
 * also sitting in theirs. If so you join them and close yours. Both clients
 * run this, and because "older" is a total order only one of them can be the
 * one who moves — the other is the one being joined. It converges in a single
 * poll, without a lock, without a queue server. */
export async function mergeQueue(env, match, meId) {
  if (match.state !== 'waiting' || match.b_player || match.a_player !== meId) return null;
  const older = await env.DB.prepare(
    `SELECT m.* FROM cf_matches m
       JOIN cf_duels d ON d.match_id = m.id
       JOIN cf_players p ON p.id = m.a_player
      WHERE m.state = 'waiting' AND m.b_player IS NULL AND m.a_player != ?
        AND p.last_seen > ? AND m.created_at < ?
      ORDER BY m.created_at ASC LIMIT 1`
  ).bind(meId, now() - LIVE, match.created_at).first();
  if (!older) return null;

  const claim = await env.DB.prepare(
    `UPDATE cf_matches SET b_player = ?, state = 'in_progress', updated_at = ?
      WHERE id = ? AND state = 'waiting' AND b_player IS NULL`
  ).bind(meId, now(), older.id).run();
  if (claim.meta.changes !== 1) return null;          // somebody beat us to it

  // our own lobby is finished with; retire it so nobody else joins a ghost
  await env.DB.prepare(
    `UPDATE cf_matches SET state = 'expired', updated_at = ?
      WHERE id = ? AND state = 'waiting' AND b_player IS NULL`
  ).bind(now(), match.id).run();

  const duel = await env.DB.prepare('SELECT * FROM cf_duels WHERE match_id = ?')
    .bind(older.id).first();
  await openKick(env, { ...older, b_player: meId }, duel, duel.kick_index);
  return older.id;
}

export const codeFor = (env, matchId) => env.DB.prepare(
  'SELECT code FROM cf_duel_codes WHERE match_id = ?'
).bind(matchId).first();
export const matchForCode = (env, code) => env.DB.prepare(
  'SELECT match_id FROM cf_duel_codes WHERE code = ?'
).bind(String(code || '').trim().toUpperCase()).first();

/* Open kick `i`, if it is not already open. Racing callers are fine: the
   primary key makes the second insert a no-op. */
export async function openKick(env, match, duel, i) {
  if (i >= duel.kicks) return null;
  const { striker, keeper } = roleFor(match, i);
  if (!striker || !keeper) return null;            // nobody has joined yet
  const t = now();
  try {
    await env.DB.prepare(
      `INSERT INTO cf_kicks (match_id, kick_index, striker, keeper, opened_at, deadline)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(match.id, i, striker, keeper, t, t + Math.ceil(duel.turn_ms / 1000)).run();
  } catch { /* already open — that is the desired end state either way */ }
  return await getKick(env, match.id, i);
}

export const getKick = (env, matchId, i) => env.DB.prepare(
  'SELECT * FROM cf_kicks WHERE match_id = ? AND kick_index = ?'
).bind(matchId, i).first();

/* Is this kick ready to be decided? Either both halves are in, or the clock
   has run out on whoever is missing. */
export function kickReady(kick, at) {
  if (kick.resolved_at) return false;
  if (kick.strike && kick.dive) return true;
  return (at || now()) >= kick.deadline;
}

/* Decide a kick, exactly once.
 *
 * The guarded UPDATE is what makes "exactly once" true under concurrency:
 * both players poll, both may find the kick ready, both compute — and because
 * the simulation is deterministic they compute the SAME outcome — but only
 * the one whose UPDATE matches `resolved_at IS NULL` gets to bank the xp. */
export async function resolveKick(env, match, duel, kick) {
  if (!kickReady(kick)) return kick;

  const t = now();
  let outcome, value = 0, xp = 0;

  if (!kick.strike) {
    // he never took it. Nothing to simulate; the kick is simply gone.
    outcome = 'timeout';
  } else {
    const swipe = JSON.parse(kick.strike);
    const raw = kick.dive ? JSON.parse(kick.dive) : null;
    // strike-relative, derived here, from two numbers neither player saw
    const dive = raw && raw.at !== undefined ? raw : diveFor(swipe, raw);
    /* Everything the client does not get to choose is applied last, so a
       field smuggled into the swipe cannot survive into the simulation. */
    const record = {
      ...swipe,
      kickIndex: kick.kick_index,
      matchSeed: match.seed >>> 0,
      difficulty: match.difficulty,
      weather: duel.weather | 0,
      dive,
    };
    const result = simulate(record);
    outcome = result.outcome;
    value = scoreValue(outcome);
    const streak = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cf_kicks
        WHERE match_id = ? AND striker = ? AND value > 0`
    ).bind(match.id, kick.striker).first();
    xp = xpValue(outcome, record, streak.n);
  }

  const res = await env.DB.prepare(
    `UPDATE cf_kicks SET outcome = ?, value = ?, xp = ?, resolved_at = ?
      WHERE match_id = ? AND kick_index = ? AND resolved_at IS NULL`
  ).bind(outcome, value, xp, t, match.id, kick.kick_index).run();

  if (res.meta.changes === 1) {
    if (xp > 0) await addXp(env, kick.striker, xp);
    // the next kick opens the moment this one is decided, so the deadline
    // clock is never running on a kick nobody has been shown yet
    await env.DB.prepare(
      'UPDATE cf_duels SET kick_index = ? WHERE match_id = ? AND kick_index = ?'
    ).bind(kick.kick_index + 1, match.id, kick.kick_index).run();
    await openKick(env, match, duel, kick.kick_index + 1);
    await env.DB.prepare('UPDATE cf_matches SET updated_at = ? WHERE id = ?')
      .bind(t, match.id).run();
  }
  return await getKick(env, match.id, kick.kick_index);
}

/* Bring a duel up to date: decide everything that is decidable, then open the
 * kick that should now be live. Called from every endpoint, so the match
 * advances on whichever player happens to be looking — there is no cron in
 * the critical path and a match cannot stall because a sweeper is late. */
export async function advance(env, match, duel) {
  if (!match.b_player) return null;                  // nobody to duel yet
  for (let guard = 0; guard <= duel.kicks; guard++) {
    let cur = await env.DB.prepare(
      `SELECT * FROM cf_kicks WHERE match_id = ? AND resolved_at IS NULL
        ORDER BY kick_index LIMIT 1`
    ).bind(match.id).first();
    if (!cur) {
      // nothing open. Either the match is finished, or the kick that should
      // be live has never been written — which can happen if a client dropped
      // between one kick resolving and the next opening.
      const d = await env.DB.prepare('SELECT * FROM cf_duels WHERE match_id = ?')
        .bind(match.id).first();
      if (!d || d.kick_index >= d.kicks) return null;
      cur = await openKick(env, match, d, d.kick_index);
      if (!cur) return null;
    }
    if (!kickReady(cur)) return cur;                 // live, waiting on a player
    await resolveKick(env, match, duel, cur);
  }
  return null;                                       // nothing outstanding
}

const PURSE_WIN = 250, PURSE_PLAY = 60, PURSE_DRAW = 120;

/* Settle once, when every kick has been decided. The ledger's unique index on
 * (player, match, reason) is the real guard — this can be called on every
 * poll from both players and still pay out once. */
export async function settle(env, match, duel) {
  const done = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM cf_kicks WHERE match_id = ? AND resolved_at IS NOT NULL'
  ).bind(match.id).first();
  if (done.n < duel.kicks) return null;

  const scores = await tally(env, match);
  const winner = scores.a === scores.b ? null
               : (scores.a > scores.b ? match.a_player : match.b_player);

  await env.DB.prepare(
    `UPDATE cf_matches SET state = 'resolved', winner = ?, updated_at = ?
      WHERE id = ? AND state = 'in_progress'`
  ).bind(winner, now(), match.id).run();

  for (const pid of [match.a_player, match.b_player]) {
    if (!pid) continue;
    const purse = PURSE_PLAY + (winner === null ? PURSE_DRAW : (pid === winner ? PURSE_WIN : 0));
    await credit(env, pid, purse, 'duel', match.id);
  }
  await env.DB.prepare(`UPDATE cf_matches SET state = 'settled' WHERE id = ? AND state = 'resolved'`)
    .bind(match.id).run();
  return { winner, scores };
}

export async function tally(env, match) {
  const rows = await env.DB.prepare(
    'SELECT striker, SUM(value) AS v FROM cf_kicks WHERE match_id = ? GROUP BY striker'
  ).bind(match.id).all();
  const get = id => (rows.results.find(r => r.striker === id) || {}).v || 0;
  return { a: get(match.a_player), b: get(match.b_player) };
}

/* ---- redaction ----------------------------------------------------------
   The only place blindness is enforced. An unresolved kick tells you your own
   half and nothing whatsoever about the other — not the value, not whether it
   has arrived, because "he has already gone" is itself information a keeper
   would pay for.

   The one thing both sides are told about a live kick is the deadline, which
   they need in order to play at all. */
export function viewKick(kick, viewerId) {
  if (!kick) return null;
  const mine = kick.striker === viewerId ? 'striker'
             : kick.keeper === viewerId ? 'keeper' : null;
  const base = {
    kickIndex: kick.kick_index,
    role: mine,
    // the moment both players start timing against. Everything either of
    // them submits is stamped as an offset from this, which is what lets the
    // keeper's dive be placed against a strike he never saw.
    openedAt: kick.opened_at,
    deadline: kick.deadline,
    resolved: !!kick.resolved_at,
  };
  if (!kick.resolved_at) {
    return {
      ...base,
      // your own submission, so a reconnecting client knows not to send again
      submitted: mine === 'striker' ? !!kick.strike : mine === 'keeper' ? !!kick.dive : false,
    };
  }
  return {
    ...base,
    outcome: kick.outcome,
    value: kick.value,
    // safe now, and necessary: both clients replay the identical kick from
    // these two inputs, which is what keeps the two screens showing the same
    // thing without streaming a single frame
    strike: kick.strike ? JSON.parse(kick.strike) : null,
    dive: kick.strike && kick.dive
      ? (() => { const d = JSON.parse(kick.dive);
                 return d.at !== undefined ? d : diveFor(JSON.parse(kick.strike), d); })()
      : ROOTED,
    strikerSide: null,   // filled in by the endpoint, which knows the match
  };
}

/* A submission is one side of one kick. Returns an error string, or null. */
export function validateHalf(role, payload) {
  if (role === 'striker') {
    // kickIndex is carried by the route, not the body, so a stale client
    // cannot aim a swipe at a different kick than the one it was handed
    const why = validateRecord({ ...payload, kickIndex: 0 });
    return why;
  }
  if (role === 'keeper') {
    if (payload === null) return null;                    // held his line
    if (!payload || typeof payload !== 'object') return 'dive';
    if (payload.held) return null;
    if (typeof payload.t === 'number') {
      if (payload.t < 0 || payload.t > 120) return 'dive.t';
      // range-check the placement through the same gate as everything else
      return validateRecord({ kickIndex: 0, power: 0, aimM: 0,
                              dive: { x: payload.x, y: payload.y, at: 0 } });
    }
    return validateRecord({ kickIndex: 0, power: 0, aimM: 0, dive: payload });
  }
  return 'role';
}

export const DIFFS = DIFF;
