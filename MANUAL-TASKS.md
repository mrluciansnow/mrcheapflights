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

## 🟠 Croker Flicks online multiplayer (unblocks online play)

The game, the server, the migrations and the deploy workflow are all in and
tested. These two need a credential, so they are yours. Full runbook:
`docs/deploy-online.md`.

- [ ] **Add two repository secrets.** GitHub -> Settings -> Secrets and
  variables -> Actions:
  `CLOUDFLARE_API_TOKEN` (a token with **Cloudflare Pages: Edit** and
  **D1: Edit**) and `CLOUDFLARE_ACCOUNT_ID`.
  *Why only you:* the token must never be pasted into a chat. Once it is a
  repo secret the workflow holds it and Claude never sees it.

- [ ] **Confirm the Pages project has a D1 binding** named `DB` ->
  `mrcheapflights-prod`, for **Production** (and Preview if you want previews
  working). Pages -> mrcheap -> Settings -> Functions -> D1 database bindings.
  *May already be set.* Don't go looking first - deploy, then hit
  `https://mrcheapflights.ie/api/mp/health`. It answers definitively:
  `bound: false` means this task is real, `ok: true` means it never was.

Then: Actions -> **Deploy** -> Run workflow, `migrate` ticked, `branch: main`,
and put `https://mrcheapflights.ie` in `url` so the run fails loudly if online
cannot serve. Claude can run that step and read the logs.

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

- [ ] **(Optional) Cloudflare Browser Cache TTL → "Respect Existing Headers"**
  (Caching → Configuration). Activates the 30-day mascot cache that `_headers`
  already sets. Low value, zero risk.

- [ ] **(Optional) Deploy the email-ingest worker** for more deal flow — say
  "deploy the email worker" to Claude, then enable Email Routing (deals@ →
  worker) in the Cloudflare dashboard.

---
Done: Google Search Console (both domains verified + sitemaps submitted),
Travelpayouts marker corrected (752435), SerpApi + TP token armed.
