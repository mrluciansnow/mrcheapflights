import { requireAdmin, verifyPassword, hashPassword, randomHex } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { currentPassword, newPassword } = await context.request.json();
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
