// POST /api/promo/redeem { code, email }
// Redeems a promo code → grants a comped premium trial (no Stripe). Premium is
// time-based, so we just push current_period_end into the future. One redeem
// per (code, email); respects max_redemptions.

import { randomHex, signSession, setCookieHeader } from '../../_lib/auth.js';

const YEAR = 60 * 60 * 24 * 400;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim().toUpperCase();
  const region = ['ie', 'uk'].includes(body.region) ? body.region : 'ie';
  if (!EMAIL_RE.test(email) || email.length > 254) return Response.json({ error: 'Invalid email' }, { status: 400 });
  if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(code)) return Response.json({ error: 'Invalid code' }, { status: 400 });

  // Rate-limit: 6 redeem attempts / IP / hour (blocks code brute-forcing).
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const rl = await context.env.DB.prepare(
      `INSERT INTO kv_rate_limit (key, count) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`
    ).bind(`promo_rl:${ip}:${Math.floor(Date.now() / 3600000)}`).first().catch(() => null);
    if (rl && rl.count > 6) return Response.json({ error: 'Too many attempts' }, { status: 429 });
  } catch { /* allow */ }

  const promo = await context.env.DB.prepare(
    'SELECT id, code, campaign_id, trial_days, max_redemptions, redeemed_count FROM promo_codes WHERE code=? AND active=1'
  ).bind(code).first();
  if (!promo) return Response.json({ error: 'That code isn\'t valid.' }, { status: 404 });
  if (promo.max_redemptions != null && promo.redeemed_count >= promo.max_redemptions) {
    return Response.json({ error: 'This code has been fully claimed.' }, { status: 410 });
  }

  // Attribute to the campaign slug when the code is linked to one.
  let source = null;
  if (promo.campaign_id) {
    const c = await context.env.DB.prepare('SELECT slug FROM campaigns WHERE id=?').bind(promo.campaign_id).first();
    source = c?.slug || null;
  }

  let sub = await context.env.DB.prepare(
    'SELECT id, member_token, current_period_end, source FROM subscribers WHERE email=?'
  ).bind(email).first();
  if (!sub) {
    const token = randomHex(24);
    const r = await context.env.DB.prepare(
      `INSERT INTO subscribers (email, region, tier, member_token, source) VALUES (?, ?, 'free', ?, ?)`
    ).bind(email, region, token, source).run();
    sub = { id: r.meta.last_row_id, member_token: token, current_period_end: null, source };
  }

  // Already redeemed this exact code? Don't extend again — return current state.
  const already = await context.env.DB.prepare(
    'SELECT id FROM promo_redemptions WHERE code=? AND email=?'
  ).bind(code, email).first();

  const now = Math.floor(Date.now() / 1000);
  if (!already) {
    // Extend from the later of "now" or their existing paid-through date.
    const from = sub.current_period_end && sub.current_period_end > now ? sub.current_period_end : now;
    const newEnd = from + promo.trial_days * 86400;
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE subscribers SET tier='premium', current_period_end=?, source=COALESCE(source, ?), updated_at=unixepoch() WHERE id=?`
      ).bind(newEnd, source, sub.id),
      context.env.DB.prepare(
        'INSERT INTO promo_redemptions (code, email, subscriber_id) VALUES (?, ?, ?)'
      ).bind(code, email, sub.id),
      context.env.DB.prepare('UPDATE promo_codes SET redeemed_count = redeemed_count + 1 WHERE id=?').bind(promo.id),
    ]);
    sub.current_period_end = newEnd;
  }

  const cookie = await signSession({ sub: sub.member_token }, context.env.SESSION_SIGNING_SECRET);
  return Response.json(
    { ok: true, premium: true, trial_days: promo.trial_days, premium_until: sub.current_period_end, already_redeemed: !!already },
    { headers: { 'Set-Cookie': setCookieHeader('mcf_member', cookie, { maxAgeSeconds: YEAR, sameSite: 'Lax' }) } }
  );
}
