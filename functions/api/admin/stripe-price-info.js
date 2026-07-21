// GET /api/admin/stripe-price-info — read-only: what currency + amount are the
// configured Stripe prices actually in? The site shows UK visitors "£4.99" but
// checkout uses ONE price per period for both regions, so if the prices are
// EUR, UK customers are billed in euros. This confirms the truth before the
// display is corrected — no dashboard access needed, nothing is charged.

import { requireAdmin } from '../../_lib/auth.js';
import Stripe from 'stripe';

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (!context.env.STRIPE_SECRET_KEY) return Response.json({ error: 'STRIPE_SECRET_KEY not set' });

  const rows = await context.env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN ('stripePriceMonthly','stripePriceAnnual')`
  ).all();
  const ids = {};
  for (const r of rows.results) ids[r.key] = r.value;

  const stripe = new Stripe(context.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  const out = { livemode: null, monthly: null, annual: null };
  for (const [k, priceId] of [['monthly', ids.stripePriceMonthly], ['annual', ids.stripePriceAnnual]]) {
    if (!priceId) { out[k] = { error: 'not configured' }; continue; }
    try {
      const p = await stripe.prices.retrieve(priceId);
      out.livemode = p.livemode;
      out[k] = {
        currency: p.currency,
        unit_amount: p.unit_amount,
        display: (p.unit_amount / 100).toFixed(2),
        recurring: p.recurring?.interval,
        has_currency_options: !!(p.currency_options && Object.keys(p.currency_options).length),
        currency_options: p.currency_options ? Object.keys(p.currency_options) : [],
      };
    } catch (e) {
      out[k] = { error: e.message };
    }
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
