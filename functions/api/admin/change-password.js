import { requireAdmin, verifyPassword, hashPassword, randomHex } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  // Rate-limit: 3 attempts per 15 minutes per IP.
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const bucket = Math.floor(Date.now() / 900000);
    const rlKey = `chpw_rl:${ip}:${bucket}`;
    const rlRow = await context.env.DB.prepare(
      `INSERT INTO kv_rate_limit (key, count) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`
    ).bind(rlKey).first().catch(() => null);
    if (rlRow && rlRow.count > 3) {
      return new Response('Too many attempts', { status: 429 });
    }
  } catch { /* allow through if table unavailable */ }

  let body;
  try { body = await context.request.json(); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { currentPassword, newPassword } = body;
  if (!newPassword || newPassword.length < 10) {
    return new Response('New password must be at least 10 characters', { status: 400 });
  }

  const row = await context.env.DB.prepare(
    'SELECT password_hash, password_salt FROM admin_auth WHERE id = 1'
  ).first();
  const ok = await verifyPassword(currentPassword || '', row.password_salt, row.password_hash);
  if (!ok) return new Response('Current password is incorrect', { status: 401 });

  const salt = randomHex(16);
  const hash = await hashPassword(newPassword, salt);
  await context.env.DB.prepare(
    'UPDATE admin_auth SET password_hash = ?, password_salt = ?, updated_at = unixepoch() WHERE id = 1'
  ).bind(hash, salt).run();

  return new Response(null, { status: 204 });
}
