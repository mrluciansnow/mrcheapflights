import { randomHex, signSession, setCookieHeader, getCookie, clearCookieHeader } from '../_lib/auth.js';
import { sendWelcomeIfNew } from '../_lib/welcome.js';
import { creditReferral, REFERRAL_CODE_RE } from '../_lib/referrals.js';
import { trackConversion } from '../_lib/conversions.js';

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
  // Creative-level attribution: /c/<slug>?v=<n> carries which ad variant drove
  // this signup. Only meaningful alongside a source; bounded 0-9 (see 0025).
  const variantRaw = parseInt(body.variant);
  const sourceVariant = source && Number.isFinite(variantRaw) && variantRaw >= 0 && variantRaw <= 9
    ? variantRaw : null;

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

  // Referral: /r/<code> sets an mcf_ref cookie carrying the referrer's
  // referral_code (never their member_token — see migration 0024).
  const refCookie = getCookie(context.request, 'mcf_ref');
  const refCode = refCookie && REFERRAL_CODE_RE.test(refCookie.toLowerCase()) ? refCookie.toLowerCase() : null;

  let row = await context.env.DB.prepare(
    'SELECT id, member_token FROM subscribers WHERE email = ?'
  ).bind(normalizedEmail).first();
  const isNew = !row;

  if (!row) {
    const memberToken = randomHex(24);
    const result = await context.env.DB.prepare(
      `INSERT INTO subscribers (email, region, tier, member_token, name, source, source_variant)
       VALUES (?, ?, 'free', ?, ?, ?, ?)`
    ).bind(normalizedEmail, region || 'ie', memberToken, safeName, source, sourceVariant).run();
    row = { id: result.meta.last_row_id, member_token: memberToken };
  }

  // Branded welcome, exactly once per address — never blocks the response.
  context.waitUntil(sendWelcomeIfNew(context.env, {
    subscriberId: row.id, email: normalizedEmail, memberToken: row.member_token, region: region || 'ie',
  }));

  // Credit the referrer — only for a genuinely new subscriber; never blocks.
  if (isNew && refCode) {
    context.waitUntil(creditReferral(context.env, { newSubId: row.id, refCode }));
  }

  // Report the conversion back to the ad platform that earned it, so its
  // optimisation model learns. Only for a genuinely new, CAMPAIGN-ATTRIBUTED
  // signup — organic signups are never shared (see _lib/conversions.js), and
  // the whole path is off unless CONVERSIONS_ENABLED=1. Never blocks.
  if (isNew && source) {
    context.waitUntil(trackConversion(context.env, {
      email: normalizedEmail, subscriberId: row.id, source, sourceVariant,
      request: context.request,
    }));
  }

  const cookieToken = await signSession({ sub: row.member_token }, context.env.SESSION_SIGNING_SECRET);
  const headers = new Headers();
  headers.append('Set-Cookie', setCookieHeader('mcf_member', cookieToken, { maxAgeSeconds: YEAR_IN_SECONDS, sameSite: 'Lax' }));
  if (refCode) headers.append('Set-Cookie', clearCookieHeader('mcf_ref')); // consumed on first signup
  return Response.json({ ok: true }, { status: 200, headers });
}
