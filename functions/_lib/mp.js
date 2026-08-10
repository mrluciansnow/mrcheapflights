// Shared helpers for the Croker Flicks multiplayer endpoints.
// Anonymous-first: a device presents a token, we mint a player row for it, and
// an email can be attached later without losing anything.

import { randomHex } from './auth.js';

export const now = () => Math.floor(Date.now() / 1000);
export const bad = (msg, status = 400) => Response.json({ error: msg }, { status });

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Resolve (or create) the player behind an X-CF-Device header. The raw token
// never lands in the database — only its hash — so a database leak does not
// hand over anyone's identity.
export async function resolvePlayer(env, request) {
  const raw = request.headers.get('X-CF-Device');
  if (!raw || raw.length < 16 || raw.length > 128) return null;
  const hash = await sha256Hex(raw);

  const found = await env.DB.prepare(
    'SELECT * FROM cf_players WHERE device_token = ?'
  ).bind(hash).first();
  if (found) {
    await env.DB.prepare('UPDATE cf_players SET last_seen = ? WHERE id = ?')
      .bind(now(), found.id).run();
    return found;
  }

  const id = 'p_' + randomHex(12);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO cf_players (id, device_token, handle, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, hash, 'Player', t, t).run();
  return await env.DB.prepare('SELECT * FROM cf_players WHERE id = ?').bind(id).first();
}

// Currency and points only ever move here, and the ledger's unique index on
// (player, match, reason) makes a replayed settlement a no-op rather than a
// double payout.
export async function credit(env, playerId, delta, reason, matchId) {
  try {
    await env.DB.prepare(
      `INSERT INTO cf_ledger (player_id, delta, reason, match_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(playerId, delta, reason, matchId || null, now()).run();
  } catch (e) {
    return false;                       // unique index tripped: already settled
  }
  await env.DB.prepare('UPDATE cf_players SET money = money + ? WHERE id = ?')
    .bind(delta, playerId).run();
  return true;
}

export async function addXp(env, playerId, xp) {
  if (xp <= 0) return;
  await env.DB.prepare('UPDATE cf_players SET xp = xp + ? WHERE id = ?')
    .bind(xp, playerId).run();
}

export const publicPlayer = p => ({
  id: p.id, handle: p.handle, county: p.county, kit: p.kit,
  xp: p.xp, money: p.money,
});
