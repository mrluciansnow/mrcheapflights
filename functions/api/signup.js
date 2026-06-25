import { randomHex, signSession, setCookieHeader } from '../_lib/auth.js';

const YEAR_IN_SECONDS = 60 * 60 * 24 * 400;

// Free signup: durably capture the email and issue a long-lived signed
// "member" cookie so /api/me can resolve premium status later without
// requiring a login. Tier stays 'free' here — premium is only ever set by
// the Stripe webhook once a real payment is confirmed.
export async function onRequestPost(context) {
  const { email, name, region } = await context.request.json();
  if (!email || !email.includes('@')) return new Response('Invalid email', { status: 400 });
  const normalizedEmail = email.trim().toLowerCase();

  let row = await context.env.DB.prepare(
    'SELECT id, member_token FROM subscribers WHERE email = ?'
  ).bind(normalizedEmail).first();

  if (!row) {
    const memberToken = randomHex(24);
    const result = await context.env.DB.prepare(
      `INSERT INTO subscribers (email, region, tier, member_token, name) VALUES (?, ?, 'free', ?, ?)`
    ).bind(normalizedEmail, region || 'ie', memberToken, name || null).run();
    row = { id: result.meta.last_row_id, member_token: memberToken };
  }

  const cookieToken = await signSession({ sub: row.member_token }, context.env.SESSION_SIGNING_SECRET);
  return Response.json({ ok: true }, {
    status: 200,
    headers: { 'Set-Cookie': setCookieHeader('mcf_member', cookieToken, { maxAgeSeconds: YEAR_IN_SECONDS, sameSite: 'Lax' }) },
  });
}
