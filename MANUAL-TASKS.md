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

## ✅ Resolved

- [x] **Travelpayouts token** — fixed (correct 32-char token). Fare verification
  + price history now flowing (verified badges + sparklines populate as the 8h
  cron runs).
- [x] **Buffer Instagram** — channel connected + posting works (draft + live).

## 🟢 Growth (unblocks channels)

- [ ] **Connect Instagram/Facebook in Buffer.** publish.buffer.com → Channels →
  Connect Channel. Social posting is fully built but posts nowhere until a
  channel is connected (Buffer currently reports 0 channels).

- [ ] **Arm the ad-automation service (Meta + TikTok).** The whole system is
  built, deployed and safe, but **inert until you connect it** — with no tokens
  set it runs in permanent dry-run (plans + logs, sends nothing). Manage it at
  **mrcheapflights.ie/marketing → 🤖 Ad automation**. To go live:
  1. **Meta:** create a Meta *Business* app with Marketing API access, generate a
     long-lived **System User token** with `ads_management`, and note your **ad
     account id** (the digits, no `act_` prefix).
     `wrangler pages secret put META_ACCESS_TOKEN` (paste the token — I never
     handle it), then enter the ad account id in the Meta row on /marketing.
  2. **TikTok:** create a *TikTok for Business* developer app, get an **access
     token** + **advertiser id**.
     `wrangler pages secret put TIKTOK_ACCESS_TOKEN`, then enter the advertiser
     id in the TikTok row on /marketing.
  3. **Allow live writes:** `wrangler pages secret put ADS_LIVE` → value `1`
     (default off = dry-run). Optional: `ADS_MAX_DAILY_BUDGET` (hard ceiling,
     default `20`), `ADS_ALLOW_SCALE` (`1` to let it raise budgets; default off).
     Run `npm run deploy` after setting secrets.
  4. **Add the sync cron** at cron-job.org: `GET /api/cron/ads-sync` every 6h,
     header `Authorization: Bearer <CRON_SECRET>`. It pulls spend, computes real
     CPA (vs your /c/ signups) and **auto-pauses** any campaign over its target
     CPA. It never activates or scales on its own.
  5. **Safety you can rely on:** campaigns are always created **PAUSED**. Even
     fully armed, nothing spends until *you* click **Activate** (or flip it live
     in Ads Manager). Recommended first run: create one small test campaign,
     inspect it in Ads Manager, then activate. The ad-set/creative payloads are
     built to Meta/TikTok's documented shapes but were not testable live without
     your account — treat the first live campaign as a supervised smoke test.

- [ ] **(Optional) Cloudflare Browser Cache TTL → "Respect Existing Headers"**
  (Caching → Configuration). Activates the 30-day mascot cache that `_headers`
  already sets. Low value, zero risk.

- [ ] **(Optional) Deploy the email-ingest worker** for more deal flow — say
  "deploy the email worker" to Claude, then enable Email Routing (deals@ →
  worker) in the Cloudflare dashboard.

---
Done: Google Search Console (both domains verified + sitemaps submitted),
Travelpayouts marker corrected (752435), SerpApi + TP token armed.
