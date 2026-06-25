import { verifyPassword, signSession, setCookieHeader } from '../../_lib/auth.js';

const SESSION_SECONDS = 8 * 60 * 60;

export async function onRequestPost(context) {
  const { password } = await context.request.json();
  if (!password) return new Response('Missing password', { status: 400 });

  const row = await context.env.DB.prepare(
    'SELECT password_hash, password_salt FROM admin_auth WHERE id = 1'
  ).first();
  if (!row) return new Response('Admin not configured', { status: 500 });

  const ok = await verifyPassword(password, row.password_salt, row.password_hash);
  if (!ok) return new Response('Invalid password', { status: 401 });

  const token = await signSession(
    { role: 'admin', exp: Date.now() + SESSION_SECONDS * 1000 },
    context.env.SESSION_SIGNING_SECRET
  );
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': setCookieHeader('mcf_admin', token, { maxAgeSeconds: SESSION_SECONDS }) },
  });
}
