import { verifyPassword, signSession, setCookieHeader } from '../../_lib/auth.js';

const SESSION_SECONDS = 8 * 60 * 60;
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch {
    return new Response('Missing password', { status: 400 });
  }
  const { password } = body;
  if (!password || typeof password !== 'string') {
    return new Response('Missing password', { status: 400 });
  }

  // IP-based rate limiting: 5 failed attempts per 15 minutes.
  const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = Math.floor(Date.now() / (WINDOW_MINUTES * 60000));
  const rlKey = `admin_login_rl:${ip}:${bucket}`;

  try {
    const rlRow = await context.env.DB.prepare(
      `INSERT INTO kv_rate_limit (key, count) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`
    ).bind(rlKey).first().catch(() => null);
    if (rlRow && rlRow.count > MAX_ATTEMPTS) {
      return new Response('Too many attempts', { status: 429 });
    }
  } catch { /* rate_limit table not available — allow through */ }

  const row = await context.env.DB.prepare(
    'SELECT password_hash, password_salt FROM admin_auth WHERE id = 1'
  ).first();
  if (!row) return new Response('Admin not configured', { status: 500 });

  const ok = await verifyPassword(password, row.password_salt, row.password_hash);
  if (!ok) return new Response('Invalid password', { status: 401 });

  // Reset rate limit counter on successful login.
  try {
    await context.env.DB.prepare('DELETE FROM kv_rate_limit WHERE key = ?').bind(rlKey).run();
  } catch { /* ignore */ }

  const token = await signSession(
    { role: 'admin', exp: Date.now() + SESSION_SECONDS * 1000 },
    context.env.SESSION_SIGNING_SECRET
  );
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': setCookieHeader('mcf_admin', token, { maxAgeSeconds: SESSION_SECONDS }) },
  });
}
