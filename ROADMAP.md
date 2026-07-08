# Roadmap — what's left to integrate & develop
_Last updated 2026-07-08. Everything not listed here is built, deployed, and verified._

## Tier 1 — Arming switches (minutes each; the feature already exists)

1. **Newsletter cron auth** — Edit the "Daily newsletter digest" job on cron-job.org → Advanced → replace `PASTE_CRON_SECRET_HERE` with the real secret.
2. **Admin password** ⚠️ CRITICAL — `mrcheap2024` is compromised (was in public page source for weeks). Change at /admin → Settings → Security.
3. **`RESEND_API_KEY`** — create free account at resend.com, verify `mrcheapflights.ie` sending domain, `wrangler pages secret put RESEND_API_KEY --project-name mrcheap`. Unlocks: subscriber digest, urgent error-fare blasts, admin daily briefing.
4. **`NEWSLETTER_ENABLED=1`** — the arming flag; until set, the digest endpoint reports what it *would* send and emails nobody.
5. **`TRAVELPAYOUTS_MARKER`** — register at travelpayouts.com (instant), set the secret. Every "Check live fares" link on both sites becomes revenue-tracked immediately, no republish.
6. **Google Search Console** — submit `/sitemap.xml` for both domains (it 404'd until 2026-07-08, so Google has never indexed the deal pages; a manual submit accelerates recrawl).
7. **Stripe live-mode check** — confirm the deployed keys are live (not test) and run one real €4.99 premium purchase end-to-end (checkout → webhook → premium unlock).

## Tier 2 — Integration gaps (hours; finishing systems that are half-wired)

8. **Social publishing keys** — `BUFFER_ACCESS_TOKEN` (one token, all platforms) or Meta direct (`META_PAGE_ACCESS_TOKEN`/`META_PAGE_ID`/`META_IG_USER_ID`). publishSocial is built and wired into the publish button; currently posts text-only (no image pipeline — see #13). Instagram requires an image, Facebook works text-only today.
9. **Admin daily-digest email has no cron** — `/api/admin/daily-digest` (your morning briefing: pending counts, expiry warnings) exists but nothing schedules it. Add an 08:00 cron-job.org job, or merge its content into the 09:30 subscriber-digest run.
10. **Server-side AI copy** — `scraped_deals.ai_copy` column is reserved but unused. Extend enrich-pending to have Haiku write 3 caption variants per deal; surface them in pipeline Step 4 (replacing the client-side string templates).
11. **Pipeline dashboard: channel + source health** — show published_email/published_social state per deal; per-source scrape stats with an alert when a source returns 0 items (e.g. to catch a dead Holiday Pirates feed URL early).
12. **`List-Unsubscribe` header** on digest emails — enables Gmail's native one-click unsubscribe; improves deliverability and spam-score.

## Tier 3 — Bigger builds (days; the pack's unported Phase 2/3 ideas + planned features)

13. **Real image generation** — pipeline Step 3 is SVG placeholders. Pack's design: Claude prompt → Ideogram → composite. CF-native equivalent: image API (Ideogram/Flux) → store in R2/Cloudflare Images → attach to deals. Unlocks Instagram publishing (#8) and deal-page OG images.
14. **Inbound newsletter scraping** — Cloudflare Email Routing + an Email Worker: subscribe a `deals@` address to Jack's Flight Club / Going / Airfarewatchdog, parse arriving mails (regex + Haiku fallback) into `scraped_deals`. This was the original "newsletter scraping mechanism" plan; nothing built yet.
15. **Price snapshot layer** (pack Phase 2) — poll Travelpayouts/Amadeus price APIs daily into a `price_snapshots` table; enables verified "was €X" claims, price-history sparklines in the deal modal, and genuine-deal scoring instead of source-trust heuristics.
16. **Personalised digests** — subscriber airport/budget/interest preferences currently live only in each visitor's localStorage. Move to the subscribers table; filter each digest per subscriber. (Also the premium hook: preference filtering as a paid feature.)
17. **Premium email tiers** — free = 09:30 daily digest; premium = instant error-fare blasts. The blast/digest split already exists in code; needs tier check on recipients + marketing copy.
18. **Full auto-publish mode** — today: confidence ≥80 auto-approves to *draft*. Final step: score ≥ a stricter threshold (e.g. 90) goes straight to live + channel fan-out with zero dashboard touch. Config flag so it can be turned off.

## Tier 4 — Hardening & housekeeping

19. **Error monitoring** — Cloudflare Tail Workers or Sentry on Pages Functions; today failures are only visible in per-endpoint JSON responses and cron-job.org history.
20. **GA4 ecommerce funnel** — begin_checkout / purchase events around the Stripe flow (view_item + book-click already tracked).
21. **More sources** — AirHint, Kiwi Deals RSS; validate Holiday Pirates + The Flight Deal actually yield IE/UK items after a week of runs (check source stats, #11).
22. **mrcheap.flights domain** (optional) — gateway middleware, directory.html and geo-detect are already deployed and waiting; just needs the domain purchase + DNS.
