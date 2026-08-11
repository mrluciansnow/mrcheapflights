// POST /api/mp/say — a line of chat, or one WebRTC signalling message.
//
// Both are the same thing to this endpoint: a short string, appended to the
// match's log, delivered to the other player by their next sync. The server
// never looks inside either.
//
//   { matchId, kind: 'chat', body: 'good save' }
//   { matchId, kind: 'rtc',  body: '{"type":"offer","sdp":"…"}' }
//
// Voice does NOT flow through here. `rtc` carries the four or five messages
// two browsers need in order to find each other — an offer, an answer, some
// ICE candidates — and the audio itself then goes peer to peer and never
// touches this server. Which is also why a microphone in a duel costs nothing
// to host: there is no media path to pay for.
import { resolvePlayer, bad } from '../../_lib/mp.js';
import { say } from '../../_lib/duel.js';

// Long enough for an SDP blob, short enough that the log cannot be a payload.
const MAX = { chat: 240, rtc: 8000 };

export async function onRequestPost(context) {
  const { env, request } = context;
  const me = await resolvePlayer(env, request);
  if (!me) return bad('device token required', 401);

  let body;
  try { body = await request.json(); } catch { return bad('bad json'); }
  const { matchId, kind } = body || {};
  if (!matchId) return bad('matchId required');
  if (kind !== 'chat' && kind !== 'rtc') return bad('kind must be chat or rtc');
  const text = typeof body.body === 'string' ? body.body : '';
  if (!text) return bad('body required');
  if (text.length > MAX[kind]) return bad(kind + ' too long');

  const match = await env.DB.prepare('SELECT * FROM cf_matches WHERE id = ?')
    .bind(matchId).first();
  if (!match) return bad('no such match', 404);
  if (match.a_player !== me.id && match.b_player !== me.id) return bad('not your match', 403);

  const them = match.a_player === me.id ? match.b_player : match.a_player;
  /* Chat is addressed to the room so it comes back to the sender too and both
     screens show one transcript in the server's order. Signalling is addressed
     to the other browser, which is the only thing that can use it. */
  await say(env, matchId, me.id, kind === 'rtc' ? them : null, kind, text);

  return Response.json({ sent: true });
}
