# Manual Tasks — things only you can do

Actions that need a dashboard login, a password, a payment method, or an OAuth
grant, so Claude can't do them autonomously. Ordered by priority.

## 🔴 Security (do soon)

- [ ] **Purge Cloudflare cache for `/.dev.vars`.**
  Dashboard → mrcheapflights.ie → **Caching → Configuration → Purge Cache** →
  purge `https://mrcheapflights.ie/.dev.vars` (or "Purge Everything").
  *Why:* a past deploy leaked the file; the edge still serves the cached copy
  for ~7 days. The session secret in it is already rotated (harmless), but the
  **Stripe test keys** in it are still valid until you do the next item.

- [ ] **Rotate the Stripe TEST keys.**
  Stripe dashboard (test mode) → Developers → API keys → roll the secret key;
  Developers → Webhooks → roll the signing secret. Then update
  `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` via
  `wrangler pages secret put …` and `npm run deploy`.
  *(Your prod LIVE key is a different value and was never leaked.)*

- [ ] **Change the admin password** (`mrcheap2024` is compromised — it shipped
  in old page source). mrcheapflights.ie/admin → Settings → Security.

## 🟡 Revenue (unblocks premium)

- [ ] **Create live-mode Stripe products/prices.** Premium checkout is broken:
  the prod key is live-mode but the price IDs are test-mode. Create €4.99/mo +
  €39.99/yr live prices in Stripe, then update `stripePriceMonthly` /
  `stripePriceAnnual` in the admin Settings panel. Diagnostic:
  `GET /api/admin/stripe-price-info`. Checkout fails gracefully until then.

## 🟡 Data (unblocks fare verification + price history)

- [ ] **Re-paste the Travelpayouts API token — it's the wrong value.** Diagnostic
  `GET /api/cron/verify-fares?debug=1` shows the stored token is 6 chars (that's
  your Partner **ID**, 752435 — not the token). The real one is a **32-char hex
  string**: Travelpayouts → Profile → **API token → Copy**, then
  `wrangler pages secret put TRAVELPAYOUTS_TOKEN --project-name=mrcheap` and
  `npm run deploy`. Until fixed, TP fare checks 401 → fewer "✓ Fare verified"
  badges and the new price-history tracker stays empty (both populate off
  verified fares). SerpApi/Google still works but is budget-limited.

## 🟢 Growth (unblocks channels)

- [ ] **Connect Instagram/Facebook in Buffer.** publish.buffer.com → Channels →
  Connect Channel. Social posting is fully built but posts nowhere until a
  channel is connected (Buffer currently reports 0 channels).

- [ ] **(Optional) Cloudflare Browser Cache TTL → "Respect Existing Headers"**
  (Caching → Configuration). Activates the 30-day mascot cache that `_headers`
  already sets. Low value, zero risk.

- [ ] **(Optional) Deploy the email-ingest worker** for more deal flow — say
  "deploy the email worker" to Claude, then enable Email Routing (deals@ →
  worker) in the Cloudflare dashboard.

---
Done: Google Search Console (both domains verified + sitemaps submitted),
Travelpayouts marker corrected (752435), SerpApi + TP token armed.
