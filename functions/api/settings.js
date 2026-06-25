import { requireAdmin } from '../_lib/auth.js';

// Keys settable through this endpoint. Deliberately whitelisted — the admin
// password hash lives in its own `admin_auth` table and is never reachable here.
const ALLOWED_KEYS = [
  'members', 'monthly', 'saving', 'waNumber', 'mailchimp',
  'igUrl', 'tkUrl', 'fbUrl', 'twUrl', 'contactEmail',
  'stripePk', 'stripePriceMonthly', 'stripePriceAnnual',
];

export async function onRequestGet(context) {
  const { results } = await context.env.DB.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const row of results) obj[row.key] = row.value;
  return Response.json(obj);
}

export async function onRequestPut(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const body = await context.request.json();
  const stmts = [];
  for (const key of ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      stmts.push(context.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(key, String(body[key])));
    }
  }
  if (stmts.length) await context.env.DB.batch(stmts);

  return new Response(null, { status: 204 });
}
