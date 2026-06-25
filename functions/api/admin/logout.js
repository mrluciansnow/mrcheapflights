import { clearCookieHeader } from '../../_lib/auth.js';

export async function onRequestPost() {
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookieHeader('mcf_admin') } });
}
