// GET /api/mp/ice — the servers two browsers need in order to find each other.
//
// STUN alone tells a browser its own public address. That is enough for most
// home connections and not enough for a great many mobile ones: behind
// symmetric NAT — which carrier-grade NAT usually is — the address a peer is
// told to use is not the address the packets will arrive from, and the call
// never connects. Voice shipped STUN-only, so it worked on wifi and quietly
// failed on 4G with nothing on screen to explain it.
//
// A TURN server fixes that by relaying. It cannot listen: WebRTC media is
// encrypted end to end with DTLS-SRTP and the relay only ever sees ciphertext.
//
// Three sources, in order of preference:
//
//   1. CLOUDFLARE REALTIME TURN, if TURN_KEY_ID and TURN_KEY_TOKEN are set.
//      Short-lived credentials are minted per request, so nothing long-lived
//      is ever handed to a browser.
//   2. ANY TURN SERVER, if TURN_URL is set (with TURN_USER / TURN_PASS).
//      A self-hosted coturn, or a provider — the shape is standard.
//   3. NOTHING, in which case this returns STUN only and says `relay: false`
//      so the client can tell a player the truth when a call fails rather
//      than leaving them looking at a dead microphone.
//
// Credentials are short-lived and scoped to one client. They are not a secret
// the way an API token is — they are meant to be in the browser — but they are
// still minted per request rather than baked into the page.
import { resolvePlayer, bad } from '../../_lib/mp.js';

const STUN = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

const TTL = 2 * 60 * 60;          // two hours: longer than any match

async function cloudflareTurn(env) {
  const id = env.TURN_KEY_ID, token = env.TURN_KEY_TOKEN;
  if (!id || !token) return null;
  try {
    const res = await fetch(
      'https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(id) +
      '/credentials/generate-ice-servers',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL }),
      });
    if (!res.ok) return null;
    const j = await res.json();
    /* Their response has been through more than one shape. Accept either, and
       treat anything else as "no relay" rather than handing the browser
       something it cannot parse. */
    const servers = Array.isArray(j.iceServers) ? j.iceServers
                  : j.iceServers ? [j.iceServers] : null;
    if (!servers || !servers.length) return null;
    return servers;
  } catch {
    return null;                  // a relay that cannot be reached is no relay
  }
}

function configuredTurn(env) {
  if (!env.TURN_URL) return null;
  const urls = String(env.TURN_URL).split(',').map(s => s.trim()).filter(Boolean);
  if (!urls.length) return null;
  const one = { urls };
  if (env.TURN_USER) one.username = env.TURN_USER;
  if (env.TURN_PASS) one.credential = env.TURN_PASS;
  return [one];
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const me = await resolvePlayer(env, request);
  if (!me) return bad('device token required', 401);

  const turn = (await cloudflareTurn(env)) || configuredTurn(env);
  const iceServers = turn ? [...STUN, ...turn] : STUN;

  return Response.json({
    iceServers,
    // whether a call can survive a network that refuses to be traversed
    relay: !!turn,
    ttl: TTL,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
