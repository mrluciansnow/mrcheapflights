// POST /api/me/prefs — store a member's deal preferences server-side so the
// daily digest can be personalised. Auth: the signed mcf_member cookie (same
// mechanism as /api/me). Visitors without a membership keep localStorage-only
// prefs; this endpoint simply isn't called for them.
import { getCookie, verifySession } from '../../_lib/auth.js';

const VALID_AIRPORTS = new Set(['DUB', 'ORK', 'SNN', 'NOC', 'KIR', 'BFS']);
const VALID_INTERESTS = new Set(['beach', 'city', 'longhaul', 'europe', 'winter sun', 'ski', 'usa', 'cheap']);

export async function onRequestPost(context) {
  const cookie = getCookie(context.request, 'mcf_member');
  if (!cookie) return new Response('Unauthorized', { status: 401 });
  const session = await verifySession(cookie, context.env.SESSION_SIGNING_SECRET);
  if (!session) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await context.request.json(); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Whitelist + clamp everything — this lands in a column the digest trusts.
  const prefs = {};
  if (Array.isArray(body.airports)) {
    prefs.airports = body.airports.filter((a) => VALID_AIRPORTS.has(a)).slice(0, 6);
  }
  if (Array.isArray(body.interests)) {
    prefs.interests = body.interests.filter((i) => VALID_INTERESTS.has(i)).slice(0, 8);
  }
  const budget = parseInt(body.budget);
  if (budget >= 20 && budget <= 800) prefs.budget = budget;

  const result = await context.env.DB.prepare(
    'UPDATE subscribers SET prefs=?, updated_at=unixepoch() WHERE member_token=?'
  ).bind(JSON.stringify(prefs), session.sub).run();

  if (!result.meta.changes) return new Response('Unknown member', { status: 404 });
  return Response.json({ ok: true, saved: prefs });
}
