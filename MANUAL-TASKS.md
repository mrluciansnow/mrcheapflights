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

- [ ] **Go live on the ad-automation service (currently in SANDBOX).**
  **Current state:** prod is seeded with **filler sandbox tokens** and
  `ADS_LIVE=1`, so **mrcheapflights.ie/marketing → 🤖 Ad automation** is fully
  playable right now — create campaigns, activate them, hit **🔄 Sync now** to
  watch simulated spend/CPA accrue, and the guardrail auto-pauses over-target
  ones. It's a *simulation*: no real ad account, no real delivery, **£0 spend**.
  Every metric is fake and labelled 🧪 sim / sandbox.

  To switch from simulation to real advertising:
  1. **Meta:** create a Meta *Business* app with Marketing API access, generate a
     long-lived **System User token** with `ads_management`, note your **ad
     account id** (digits, no `act_`). `wrangler pages secret put META_ACCESS_TOKEN`
     (paste the real token — I never handle it), then enter the ad account id in
     the Meta row on /marketing.
  2. **TikTok:** *TikTok for Business* app → **access token** + **advertiser id**.
     `wrangler pages secret put TIKTOK_ACCESS_TOKEN`, enter the advertiser id.
  3. `npm run deploy` after setting secrets.
     ⚠️ **`ADS_LIVE=1` is ALREADY set** — the moment a token is a *real* one
     (not `sandbox…`), that platform leaves simulation and can spend. To keep
     dry-run instead of sandbox while you set up, remove `ADS_LIVE`
     (`wrangler pages secret delete ADS_LIVE`). Optional: `ADS_MAX_DAILY_BUDGET`
     (hard ceiling, default `20`), `ADS_ALLOW_SCALE` (`1` to allow budget raises).
  4. **Add the sync cron** at cron-job.org: `GET /api/cron/ads-sync` every 6h,
     header `Authorization: Bearer <CRON_SECRET>`. Pulls spend, computes real CPA
     (vs your /c/ signups), **auto-pauses** over-target campaigns. Never activates
     or scales on its own.
  5. **Safety that holds even when live:** campaigns are always created **PAUSED**;
     the engine never activates — *you* click **Activate** (or do it in Ads
     Manager). First real run: create one small test campaign, inspect it in Ads
     Manager, then activate. The ad-set payloads follow Meta/TikTok's documented
     shapes but weren't testable against a real account — treat the first live
     campaign as a supervised smoke test.
  - ✨ **Ad copy:** the ✨ button on any campaign generates Claude-written ad-copy
    variants (headline / primary text / CTA / concept) to paste into Ads Manager.
    Works now (uses the existing `ANTHROPIC_API_KEY`), independent of go-live.

- [x] ~~**Schedule the weekly marketing report**~~ — DONE (job 8198131, Mondays 08:00) (2 min, needs your cron-job.org
  login). The report is built and deployed but nothing triggers it yet.
  cron-job.org → Create cronjob → URL
  `https://mrcheapflights.ie/api/cron/weekly-report`, schedule **Mondays 08:00**
  (Europe/London), header `Authorization: Bearer <CRON_SECRET>`.
  *Preview it right now without waiting:* open
  `https://mrcheapflights.ie/api/cron/weekly-report?preview=1` while logged into
  admin — that renders the email in the browser and sends nothing.

- [ ] **(Decision, not a chore) Turn on conversion events — or don't.**
  Built and deployed but **OFF**. When on, a signup that came from a tracked ad
  is reported back to Meta/TikTok (hashed email only) so their algorithms
  optimise toward people who actually convert — normally a large CPA
  improvement. Organic signups are never sent.
  *Why it's your call:* it shares hashed subscriber data with an ad platform,
  which for IE/UK subscribers is a GDPR/consent question. Your privacy policy
  should cover ad-platform data sharing before enabling.
  To enable: set the **pixel id** per platform on /marketing, then
  `wrangler pages secret put CONVERSIONS_ENABLED` → `1`, then `npm run deploy`.
  (While the ad tokens are sandbox fillers it stays simulated regardless.)

- [ ] **(Optional) Cloudflare Browser Cache TTL → "Respect Existing Headers"**
  (Caching → Configuration). Activates the 30-day mascot cache that `_headers`
  already sets. Low value, zero risk.

- [x] ~~**Email newsletter ingestion**~~ — **DONE, fully wired by Claude.**
  Worker `mrcheap-email-ingest` deployed; Email Routing rule
  `deals@mrcheapflights.ie → mrcheap-email-ingest` created and **Active**; a
  fresh shared `INGEST_SECRET` generated and set on both the worker and the
  Pages project (your existing CRON_SECRET was never read or needed).

  **Deliberately used mrcheapflights.ie, NOT .co.uk** — .co.uk's MX records
  point at Google/Outlook (that's where admin@mrcheapflights.co.uk lives) and
  enabling Cloudflare routing there would have broken your real mailbox. The
  .ie domain already had Email Routing on with zero rules, so nothing was at
  risk.

  **All that's left is to use it:** subscribe `deals@mrcheapflights.ie` to
  Jack's Flight Club, Secret Flying, Going, Travel-Dealz, Fly4Free,
  HolidayPirates. Only those 7 allowlisted senders are accepted.
  *Quick smoke test:* email `deals@mrcheapflights.ie` from anywhere — it should
  be rejected as a non-allowlisted sender, which proves the chain is live.
  Watch it in Cloudflare → Email Routing → **Activity Log**, and in the
  pipeline queue for real newsletters.

---
Done: Google Search Console (both domains verified + sitemaps submitted),
Travelpayouts marker corrected (752435), SerpApi + TP token armed.
