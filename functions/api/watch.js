// POST /api/watch  { email, region, dest, maxPrice? }
// Creates a destination price alert (and a free subscriber if new). Returns
// { ok, already: <deal|null> } — `already` is a matching live deal right now,
// so the hub page can reward the signup instantly ("there's one live!").

import { randomHex, signSession, setCookieHeader } from '../_lib/auth.js';
import { getDestination, destSlugForText } from '../_lib/destinations.js';

const YEAR = 60 * 60 * 24 * 400;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const email = String(body.email || '').trim().toLowerCase();
  const region = ['ie', 'uk'].includes(body.region) ? body.region : 'ie';
  const destSlug = String(body.dest || '').toLowerCase();
  const dest = getDestination(destSlug);
  const maxPrice = Number.isFinite(+body.maxPrice) && +body.maxPrice > 0 ? Math.round(+body.maxPrice) : null;

  if (!EMAIL_RE.test(email) || email.length > 254) return new Response('Invalid email', { status: 400 });
  if (!dest) return new Response('Unknown destination', { status: 400 });

  // Rate-limit: 8 watch/signup actions per IP per hour.
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const rlKey = `watch_rl:${ip}:${Math.floor(Date.now() / 3600000)}`;
    const rl = await context.env.DB.prepare(
      `INSERT INTO kv_rate_limit (key, count) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`
    ).bind(rlKey).first().catch(() => null);
    if (rl && rl.count > 8) return new Response('Too many requests', { status: 429 });
  } catch { /* table missing — allow */ }

  // Ensure subscriber
  let sub = await context.env.DB.prepare(
    'SELECT id, member_token FROM subscribers WHERE email=?'
  ).bind(email).first();
  if (!sub) {
    const token = randomHex(24);
    const r = await context.env.DB.prepare(
      `INSERT INTO subscribers (email, region, tier, member_token) VALUES (?, ?, 'free', ?)`
    ).bind(email, region, token).run();
    sub = { id: r.meta.last_row_id, member_token: token };
  }

  // Upsert watchlist (reactivate + update cap if it already exists)
  await context.env.DB.prepare(
    `INSERT INTO watchlists (subscriber_id, email, member_token, region, dest_slug, max_price, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(email, dest_slug) DO UPDATE SET
       active=1, region=excluded.region, max_price=excluded.max_price`
  ).bind(sub.id, email, sub.member_token, region, destSlug, maxPrice).run();

  // Is there a live matching deal right now? (instant gratification)
  let already = null;
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT route, price, slug FROM deals
       WHERE region=? AND status='live' AND (expiry IS NULL OR date(expiry) >= date('now'))
       ORDER BY created_at DESC LIMIT 40`
    ).bind(region).all();
    const match = (results || []).find((d) => {
      if (destSlugForText(d.route) !== destSlug) return false;
      if (maxPrice) { const n = parseFloat(String(d.price).replace(/[^0-9.]/g, '')); if (!isNaN(n) && n > maxPrice) return false; }
      return true;
    });
    if (match) already = { route: match.route, price: match.price, slug: match.slug };
  } catch { /* non-critical */ }

  // Branded welcome (mentions their armed alert), once per address —
  // fire-and-forget so the watch response stays instant.
  context.waitUntil(sendWelcomeIfNew(context.env, {
    subscriberId: sub.id, email, memberToken: sub.member_token, region, destName: dest.name,
  }));

  const cookie = await signSession({ sub: sub.member_token }, context.env.SESSION_SIGNING_SECRET);
  return Response.json({ ok: true, already, destination: dest.name }, {
    headers: { 'Set-Cookie': setCookieHeader('mcf_member', cookie, { maxAgeSeconds: YEAR, sameSite: 'Lax' }) },
  });
}
