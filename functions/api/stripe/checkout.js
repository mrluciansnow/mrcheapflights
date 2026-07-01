import Stripe from 'stripe';
import { randomHex, signSession, setCookieHeader } from '../../_lib/auth.js';

const YEAR_IN_SECONDS = 60 * 60 * 24 * 400;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

// Creates a real Stripe Checkout Session for the chosen billing period.
// Replaces the old static Payment Link, which couldn't tell monthly from
// annual and gave no reliable way to attribute payment back to a subscriber.
export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { email, name, billing, region } = body;

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 254) {
    return new Response('Invalid email', { status: 400 });
  }
  if (region && !['ie', 'uk'].includes(region)) {
    return new Response('Invalid region', { status: 400 });
  }
  if (name && (typeof name !== 'string' || name.length > 100)) {
    return new Response('Invalid name', { status: 400 });
  }
  const normalizedEmail = email.trim().toLowerCase();

  let row = await context.env.DB.prepare(
    'SELECT id, member_token FROM subscribers WHERE email = ?'
  ).bind(normalizedEmail).first();
  if (!row) {
    const memberToken = randomHex(24);
    const result = await context.env.DB.prepare(
      `INSERT INTO subscribers (email, region, tier, member_token, name) VALUES (?, ?, 'free', ?, ?)`
    ).bind(normalizedEmail, region || 'ie', memberToken, name || null).run();
    row = { id: result.meta.last_row_id, member_token: memberToken };
  }

  const settingsRows = await context.env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN ('stripePriceMonthly', 'stripePriceAnnual')`
  ).all();
  const settings = {};
  for (const r of settingsRows.results) settings[r.key] = r.value;
  const priceId = billing === 'annual' ? settings.stripePriceAnnual : settings.stripePriceMonthly;
  if (!priceId) return new Response('Stripe price not configured', { status: 500 });

  const stripe = new Stripe(context.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  const origin = new URL(context.request.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: normalizedEmail,
    client_reference_id: String(row.id),
    subscription_data: { metadata: { subscriberId: String(row.id), region: region || 'ie' } },
    metadata: { subscriberId: String(row.id), region: region || 'ie', billing: billing || 'monthly' },
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancel`,
  });

  const cookieToken = await signSession({ sub: row.member_token }, context.env.SESSION_SIGNING_SECRET);
  return Response.json({ url: session.url }, {
    status: 200,
    headers: { 'Set-Cookie': setCookieHeader('mcf_member', cookieToken, { maxAgeSeconds: YEAR_IN_SECONDS, sameSite: 'Lax' }) },
  });
}
