# Roadmap — what's left
_Last updated 2026-07-08 (post automation-sweep, commit 30ecd36). Done and verified: affiliate layer, publish orchestrator, subscriber digest + unsubscribe, AI captions, source-health display, List-Unsubscribe, premium-only blasts, AUTO_PUBLISH flag, GA4 purchase funnel, **AI image generation (Workers AI → D1 → /images/*)**, **personalised digests (prefs)**, deal landing pages, sitemap.xml fix, 5 cron jobs, Holiday Pirates feed fix._

## Needs one action from you

1. **Paste `CRON_SECRET`** into the "Admin morning briefing" (09:15) job header on cron-job.org — last placeholder remaining.
2. **Resend review** — submitted 2026-07-08, reply lands at mrluciansnow@gmail.com within ~1 business day. When approved, tell Claude: next steps are add domain → DNS records → API key → `RESEND_API_KEY` secret → `NEWSLETTER_ENABLED=1`.
3. **Deploy the email-ingest worker** (code complete in `workers/email-ingest/`, blocked overnight pending your go-ahead):
   ```powershell
   cd C:\Users\scath\MrCheapFlights\workers\email-ingest
   & "C:\Program Files\nodejs\node.exe" "..\..\node_modules\wrangler\bin\wrangler.js" deploy
   ```
   Then 2 dashboard clicks: mrcheapflights.ie zone → Email Routing → enable → route `deals@mrcheapflights.ie` → Send to Worker → `mrcheap-email-ingest`. Then subscribe that address to Jack's Flight Club / Going / Airfarewatchdog.
4. **Travelpayouts** — sign up (free) at travelpayouts.com; your marker (a number, shown top-right after login) is public — paste it in chat and Claude wires it.
5. **Search Console** — log into search.google.com/search-console in Chrome and tell Claude; verification + sitemap submission for both domains gets driven for you.
6. **Buffer** (social auto-posting) — create account, connect IG/FB, create an access token, then `wrangler pages secret put BUFFER_ACCESS_TOKEN --project-name mrcheap` (paste it yourself at the prompt). Everything downstream is already wired, including generated images on posts.
7. **(Optional) Enable R2** — dashboard → R2 → accept terms. Images currently live in D1 (works fine at this volume); R2 swap is a 10-line change when enabled.
8. **(Later) Stripe live-mode check** — one real €4.99 purchase end-to-end.
9. **(Ignored by choice) Admin password** — mrcheap2024 remains compromised; flagged, your call.

## Bigger builds still open

- **#15 Price snapshot layer** — needs Travelpayouts/Amadeus API keys first (blocked on #4).
- **#19 Error monitoring** — Tail Workers (paid) or Sentry (account); cron-job.org failure emails cover the crons meanwhile.
- **#22 mrcheap.flights domain** — purchase only; gateway code is deployed and waiting.
- **AUTO_PUBLISH=1** — flip when you trust the ≥90-confidence scoring after watching it for a week or two.
