# Mr Cheap Flights — Operations Runbook

Internal ops doc. **Not** served publicly (the deploy allowlist excludes it).

## ⚠️ Deploy — read this first

**Always deploy with `npm run deploy`.** It stages only public files into a
clean `.dist/` and ships that.

**NEVER run `wrangler pages deploy .`** — it uploads the *entire* repo dir
(it ignores `.gitignore`), which once published `/.dev.vars` and leaked
`SESSION_SIGNING_SECRET` + Stripe keys. `scripts/deploy.mjs` is an allowlist
and hard-aborts if a secret file slips into `.dist/`.

```
npm run deploy            # → production (main)
npm run deploy -- --preview   # → preview branch
npm run smoke             # 17 public checks against prod
```

`wrangler.toml` stays in the repo root (read from CWD for the D1/AI bindings)
but is never uploaded.

## Architecture

- **Cloudflare Pages** project `mrcheap` — domains mrcheapflights.ie + .co.uk
  (region auto-detected from hostname).
- **D1** database `mrcheapflights-prod` (id 9db20f98-…), binding `DB`.
- **Workers AI** (`@cf/black-forest-labs/flux-1-schnell`), binding `AI` — deal
  hero images, stored base64 in the D1 `images` table, served via `/images/*`.
- **Functions** in `functions/` — all API + server-rendered pages.
- Account `3446dbb70587f4d7ca404cbc050a0a1d`. GitHub: mrluciansnow/mrcheapflights.

## Secrets (Cloudflare Pages → prod env)

`SESSION_SIGNING_SECRET` · `STRIPE_SECRET_KEY` (LIVE — see Stripe note) ·
`STRIPE_WEBHOOK_SECRET` · `ANTHROPIC_API_KEY` · `RESEND_API_KEY` ·
`NEWSLETTER_ENABLED=1` · `CRON_SECRET` · `TRAVELPAYOUTS_MARKER=752435` ·
`TRAVELPAYOUTS_TOKEN` · `SERPAPI_KEY` · `BUFFER_ACCESS_TOKEN`

Ad automation (all optional — absent ⇒ permanent dry-run, nothing is sent):
`META_ACCESS_TOKEN` · `TIKTOK_ACCESS_TOKEN` · `ADS_LIVE` (`1` permits live
writes; default off) · `ADS_MAX_DAILY_BUDGET` (hard ceiling, default `20`) ·
`ADS_ALLOW_SCALE` (`1` allows budget raises; default off). Ad-account /
advertiser ids are non-secret and set in the /marketing UI (D1 `ad_accounts`).

Set/rotate: `echo <value> | npx wrangler pages secret put NAME --project-name=mrcheap`
then `npm run deploy` (secrets apply on the next deployment).

## Cron jobs (cron-job.org, Europe/London, Bearer CRON_SECRET)

| Job | Endpoint | Schedule |
|---|---|---|
| Scrape deals | /api/admin/trigger-scrape | 07:00 daily |
| AI enrich + auto-approve | /api/admin/enrich-pending | 09:00 daily |
| Admin briefing | /api/admin/daily-digest | 09:15 daily |
| Deal image backfill | /api/cron/generate-images | 09:20 daily |
| Daily newsletter | /api/cron/send-newsletter | 09:30 daily |
| Price alerts dispatch | /api/cron/send-alerts | hourly :35 |
| Fare verification | /api/cron/verify-fares | 00:15/08:15/16:15 |
| Destination SEO content | /api/admin/generate-destination-content | 03:00 daily |
| Nightly cleanup | /api/admin/cleanup | 02:00 daily |
| Health monitor | /api/health | every 10 min (emails on 2 fails) |
| Ad sync + guardrail | /api/cron/ads-sync | every 6h (dry-run until armed) |

## Ad automation (Meta + TikTok)

Programmatic campaign management, managed at **/marketing → 🤖 Ad automation**.
D1 is the brain (`ad_campaigns`, `ad_actions`, `ad_accounts`); the platforms are
the executor. Spend is joined against internal `/c/` signups for a true CPA.

Files: `_lib/ads-meta.js` (Graph v21.0), `_lib/ads-tiktok.js` (Business API
v1.3), `_lib/ads-engine.js` (orchestrator + guardrails), `api/admin/ads*.js`
(UI API), `api/cron/ads-sync.js` (6h sync + auto-pause).

**Safety model — four hard invariants (enforced in `ads-engine.js`):**
1. **Dry-run by default.** No platform write unless `ADS_LIVE=1` *and* that
   platform is configured (token + account id). Otherwise the intended request
   is planned + logged to `ad_actions`, never sent.
2. **Paused-only creation.** Launch creates the campaign PAUSED. The engine
   never activates — going live is a human action (admin "Activate" click, or in
   Ads Manager). The cron never activates.
3. **Hard budget ceiling.** `planCampaign` refuses any daily budget above
   `ADS_MAX_DAILY_BUDGET` (default €20).
4. **Guardrail only pauses.** The 6h cron pauses over-target-CPA campaigns
   (spend ↓, always safe); it never raises budgets unless `ADS_ALLOW_SCALE=1`.

With no tokens set (default), the whole system is inert — plans and reports,
touches nothing. See MANUAL-TASKS.md → "Arm the ad-automation service" to go live.

## Monitoring

- **`/api/health`** — public probe. 200 when D1 is reachable AND op_log has a
  row <26h old (cron-staleness canary); 503 otherwise. Watched by the 10-min
  monitor job, which emails on 2 consecutive failures.
- **Morning briefing** (09:15 email) — per-cron 24h status, pending deals,
  business metrics (clicks, alerts), fare-verification summary.

## Failure playbook

- **Site down / health 503** → check the monitor email + `wrangler pages
  deployment list`; roll back via `wrangler pages deployment` or redeploy last
  good commit with `npm run deploy`.
- **A cron failing** → shows in the morning briefing; re-run manually from the
  admin pipeline page (🔄/🤖/🎨/🔔/📋 buttons) or `curl -X POST` with the
  Bearer CRON_SECRET.
- **Bad data live** (wrong flag, junk deal) → pipeline → Live tab, or D1:
  `UPDATE deals SET status='draft' WHERE id=?`.
- **D1 restore** → Cloudflare dash → D1 → mrcheapflights-prod → **Time Travel**
  (point-in-time restore up to 30 days back). No manual backups needed.

## Stripe status (as of 2026-07-19)

⚠️ Prod `STRIPE_SECRET_KEY` is a **live-mode** key but the configured price IDs
are **test-mode** → live checkout can't create sessions. Checkout now fails
gracefully (captures the free subscriber, returns 503 `premium_unavailable`).
**To open premium:** create live-mode products/prices in the Stripe dashboard
and update `stripePriceMonthly` / `stripePriceAnnual` in the `settings` table
(or the admin Settings panel). Diagnostic: `GET /api/admin/stripe-price-info`.

## Security note — .dev.vars leak (2026-07-19, remediated)

Bare `wrangler pages deploy .` had been publishing `/.dev.vars`. Fixed with the
allowlist deploy; `SESSION_SIGNING_SECRET` rotated. Outstanding user actions:
purge the Cloudflare edge cache for `/.dev.vars`, and rotate the Stripe **test**
key + webhook secret in the Stripe dashboard. See `memory/overnight_backlog.md`.
