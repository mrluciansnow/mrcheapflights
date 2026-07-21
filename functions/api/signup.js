import { randomHex, signSession, setCookieHeader } from '../_lib/auth.js';
import { sendWelcomeIfNew } from '../_lib/welcome.js';

const YEAR_IN_SECONDS = 60 * 60 * 24 * 400;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { email, name, region } = body;
  // Campaign attribution: /c/<slug> landing pages post source=<slug>.
  const source = typeof body.source === 'string' && /^[a-z0-9][a-z0-9-]{0,48}$/i.test(body.source)
    ? body.source.toLowerCase() : null;

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 254) {
    return new Response('Invalid email', { status: 400 });
  }
  if (region && !['ie', 'uk'].includes(region)) {
    return new Response('Invalid region', { status: 400 });
  }
  if (name && (typeof name !== 'string' || name.length > 100)) {
    return new Response('Invalid name', { status: 400 });
  }

  // Rate-limit: 5 signups per IP per hour (blocks scrapers and spam bots).
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const hour = Math.floor(Date.now() / 3600000);
    const rlKey = `signup_rl:${ip}:${hour}`;
    const rlRow = await context.env.DB.prepare(
      `INSERT INTO kv_rate_limit (key, count) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`
    ).bind(rlKey).first().catch(() => null);
    if (rlRow && rlRow.count > 5) {
      return new Response('Too many signups', { status: 429 });
    }
  } catch { /* table not yet created — allow through */ }

  const normalizedEmail = email.trim().toLowerCase();
  const safeName = name ? name.trim().slice(0, 100) : null;

  let row = await context.env.DB.prepare(
    'SELECT id, member_token FROM subscribers WHERE email = ?'
  ).bind(normalizedEmail).first();

  if (!row) {
    const memberToken = randomHex(24);
    const result = await context.env.DB.prepare(
      `INSERT INTO subscribers (email, region, tier, member_token, name, source) VALUES (?, ?, 'free', ?, ?, ?)`
    ).bind(normalizedEmail, region || 'ie', memberToken, safeName, source).run();
    row = { id: result.meta.last_row_id, member_token: memberToken };
  }

  // Branded welcome, exactly once per address — never blocks the response.
  context.waitUntil(sendWelcomeIfNew(context.env, {
    subscriberId: row.id, email: normalizedEmail, memberToken: row.member_token, region: region || 'ie',
  }));

  const cookieToken = await signSession({ sub: row.member_token }, context.env.SESSION_SIGNING_SECRET);
  return Response.json({ ok: true }, {
    status: 200,
    headers: { 'Set-Cookie': setCookieHeader('mcf_member', cookieToken, { maxAgeSeconds: YEAR_IN_SECONDS, sameSite: 'Lax' }) },
  });
}
