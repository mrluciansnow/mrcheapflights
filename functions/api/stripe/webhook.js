import Stripe from 'stripe';

// Reconciles real Stripe subscription state into D1 — this is the piece
// that was completely missing before: nothing ever told the backend that a
// payment had actually succeeded. Verifies the signature with the async
// variant required on the Workers runtime (the sync constructEvent() needs
// Node's crypto and does not work here).
export async function onRequestPost(context) {
  const raw = await context.request.text();
  const sig = context.request.headers.get('stripe-signature');
  const stripe = new Stripe(context.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

  let event;
  try {
    const webCrypto = Stripe.createSubtleCryptoProvider();
    event = await stripe.webhooks.constructEventAsync(raw, sig, context.env.STRIPE_WEBHOOK_SECRET, undefined, webCrypto);
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  // Idempotency — Stripe retries deliveries, so a replayed event id is a no-op.
  const already = await context.env.DB.prepare('SELECT id FROM stripe_events WHERE id = ?').bind(event.id).first();
  if (already) return new Response(null, { status: 200 });
  await context.env.DB.prepare('INSERT INTO stripe_events (id, type) VALUES (?, ?)').bind(event.id, event.type).run();

  async function upsertSubscription({ subscriberId, subscriptionId, customerId, status, periodEnd }) {
    const tier = periodEnd && periodEnd > Math.floor(Date.now() / 1000) ? 'premium' : 'free';
    if (subscriberId) {
      await context.env.DB.prepare(
        `UPDATE subscribers SET tier=?, stripe_customer_id=?, stripe_subscription_id=?, subscription_status=?, current_period_end=?, updated_at=unixepoch()
         WHERE id=?`
      ).bind(tier, customerId, subscriptionId, status, periodEnd, subscriberId).run();
    } else {
      // No metadata (e.g. a subscription event not tied back to our checkout) — match by subscription id instead.
      await context.env.DB.prepare(
        `UPDATE subscribers SET tier=?, subscription_status=?, current_period_end=?, updated_at=unixepoch()
         WHERE stripe_subscription_id=?`
      ).bind(tier, status, periodEnd, subscriptionId).run();
    }
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const subscriberId = session.metadata && session.metadata.subscriberId;
      let periodEnd = null;
      try {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        periodEnd = sub.current_period_end || null;
      } catch {
        // Falls back to the companion customer.subscription.created event, which fires moments later.
      }
      await upsertSubscription({
        subscriberId,
        subscriptionId: session.subscription,
        customerId: session.customer,
        status: 'active',
        periodEnd,
      });
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const sub = event.data.object;
      await upsertSubscription({
        subscriberId: sub.metadata && sub.metadata.subscriberId,
        subscriptionId: sub.id,
        customerId: sub.customer,
        status: sub.status,
        periodEnd: sub.current_period_end || null,
      });
    }
  } catch (err) {
    return new Response(`Webhook handler error: ${err.message}`, { status: 500 });
  }

  return new Response(null, { status: 200 });
}
