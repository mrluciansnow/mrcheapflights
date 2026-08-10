# Phase 4 Publishing Layer — Integration Notes

The `mcf-phase4-pack.zip` was written for a Next.js + Vercel + Supabase stack.
This site runs Cloudflare Pages Functions + D1, so the pack was **ported, not
copied** — per its own instruction to "inspect how the existing site renders
deal pages and adapt". Its referenced Phase 2/3 packs were never part of this
repo; their role is covered by the existing scraper (`_lib/scraper.js`) and AI
enrichment (`api/admin/enrich-pending.js`).

## What landed where

| Pack file | Ported to | Notes |
|---|---|---|
| `lib/publish/buildAffiliateUrl.ts` | `functions/_lib/affiliate.js` | + city→IATA map: our routes are display text, not IATA |
| `lib/publish/publishEmail.ts` | `functions/_lib/publishers.js` | **Resend** is the live path (already wired); Mailchimp stays a SHELL note |
| `lib/publish/publishSocial.ts` | `functions/_lib/publishers.js` | Buffer / Meta, faithful port, SHELL until keys set |
| `lib/publish/publishWebsite.ts` | *(no new code)* | "Published to website" = `deals.status='live'` in D1 — the site + RSS already render from there, one row per region (localisation built-in) |
| `app/api/pipeline/publish/route.ts` | `functions/api/admin/publish.js` | POST `{dealIds}` — idempotent per-channel fan-out |
| `app/api/cron/send-newsletter/route.ts` | `functions/api/cron/send-newsletter.js` | Per-region digest via Resend, double-gated (see below) |
| *(new)* | `functions/api/unsubscribe.js` | One-click digest opt-out (GDPR), linked in every email footer |
| *(new)* | `migrations/0007_publish_channels.sql` | `deals.published_email/social`, `subscribers.newsletter_opt_out` |

Also wired: `GET /api/deals` now returns `search_url` per deal (Aviasales
search derived from route text; tp.media-wrapped once the marker is set), the
site shows a "🔍 Check live fares →" link in the deal modal + deal page, and
the pipeline dashboard's Publish button fans out to all channels and reports
per-channel results.

## ⚠️ Morning steps (in order)

1. **Apply migration 0007** (blocked overnight by design — additive only):
   ```powershell
   cd C:\Users\scath\MrCheapFlights
   & "C:\Program Files\nodejs\node.exe" "node_modules\wrangler\bin\wrangler.js" d1 execute mrcheapflights-prod --remote --file="migrations/0007_publish_channels.sql"
   ```
   Until this runs, `/api/admin/publish` and the newsletter endpoint error on
   the missing columns (everything else is unaffected).

2. **Newsletter cron job** — add on cron-job.org when ready:
   - URL: `https://mrcheapflights.ie/api/cron/send-newsletter`
   - Method: POST · Schedule: `30 9 * * *` (09:30 Europe/London, after enrich)
   - Header: `Authorization: Bearer <CRON_SECRET>` (same secret as the other 3 jobs)
   - Harmless to add early: the endpoint reports-only until armed.

3. **Arm the newsletter** (when you're happy with the audience + content):
   `wrangler pages secret put NEWSLETTER_ENABLED --project-name mrcheap` → value `1`
   Then redeploy. Without it the endpoint runs in shell mode: reports what it
   *would* send, emails nobody.

## Env vars (Cloudflare Pages, not Vercel — set names via `wrangler pages secret put <NAME> --project-name mrcheap`)

| Var | Status | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ set | AI enrichment |
| `CRON_SECRET` | ✅ set | Cron auth (all cron endpoints) |
| `SESSION_SIGNING_SECRET` | ✅ set | Admin sessions |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | ✅ set | Payments |
| `RESEND_API_KEY` | set it if not yet | Email sending (digest + blasts no-op without) |
| `NEWSLETTER_ENABLED` | ⬜ **off by default** | Arming flag for subscriber emails — set to `1` to go live |
| `TRAVELPAYOUTS_MARKER` | ⬜ optional | Affiliate revenue — register at travelpayouts.com; links stay clean without it |
| `BUFFER_ACCESS_TOKEN` | ⬜ optional | Social auto-posting (option A) |
| `META_PAGE_ACCESS_TOKEN` / `META_PAGE_ID` / `META_IG_USER_ID` | ⬜ optional | Social direct (option B) |
| `MAILCHIMP_*` | ⬜ not used | Pack's email path — swap in only if the list outgrows Resend |
| Supabase vars | ❌ N/A | No Supabase — D1 binding in `wrangler.toml` |

## Pack tasks 6–8 mapping

- **Task 6 (SQL)**: Supabase SQL → D1 migration `0007` (step 1 above). The
  pack's `published_deals` table isn't needed — `deals` already serves that role.
- **Task 7 (crons)**: `scan-deals`/`check-rss` → existing 07:00 scrape job;
  `update-price-history`/`verify-live` → N/A (price-snapshot schema belongs to
  the never-integrated Phase 2 pack; our scraper+enrich covers sourcing);
  `send-newsletter` → step 2 above. Existing jobs: scrape 07:00 · enrich 09:00
  · cleanup 02:00 (all Europe/London on cron-job.org).
- **Task 8 (deps)**: none installed. No Supabase here, and `sharp` doesn't run
  on Workers (image compositing would use Cloudflare Images if Phase 3's image
  generation ever lands). Zero new npm dependencies.

## Channel behaviour (pack conventions kept)

- One failing channel never blocks the others; per-channel columns make
  publishes retryable without double-posting.
- `SHELL` markers kept verbatim — `grep -r "SHELL" functions/` lists every
  manual wiring point.
- Error fares (⚠️ Mistake Fare badge) blast immediately on publish (when
  armed); everything else waits for the 09:30 digest.
- Resend free tier = 100 emails/day → sends are capped at 90/run and reported
  as `truncated` when the list is bigger.
