import { getCookie, verifySession } from '../_lib/auth.js';

// Resolves premium status from the signed member cookie — replaces the old
// client-editable `localStorage.premium` flag with a server-verified check.
// Premium is purely time-based: valid while current_period_end is in the
// future, regardless of the cached subscription_status string (this is what
// keeps a cancelled-but-already-paid-for period accessible until it ends).
export async function onRequestGet(context) {
  const cookie = getCookie(context.request, 'mcf_member');
  const noCache = { headers: { 'Cache-Control': 'private, no-store' } };
  // member:false = guest — distinct from a logged-in free member, which the
  // fare-details gating needs ("log in to see" vs "upgrade to see").
  if (!cookie) return Response.json({ premium: false, tier: 'free', member: false }, noCache);

  const session = await verifySession(cookie, context.env.SESSION_SIGNING_SECRET);
  if (!session) return Response.json({ premium: false, tier: 'free', member: false }, noCache);

  const row = await context.env.DB.prepare(
    'SELECT email, current_period_end FROM subscribers WHERE member_token = ?'
  ).bind(session.sub).first();
  if (!row) return Response.json({ premium: false, tier: 'free', member: false }, noCache);

  const now = Math.floor(Date.now() / 1000);
  const premium = row.current_period_end != null && row.current_period_end > now;
  return Response.json({ premium, tier: premium ? 'premium' : 'free', member: true, email: row.email }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
