# Email ingest worker

A ~30-line Cloudflare Email Worker that forwards newsletters to
`POST /api/ingest/email`, where the actual parsing lives. Deliberately dumb: it
does no parsing, so changing how deals are read never means redeploying it.

Deals arriving this way are the highest-value source — Jack's Flight Club and
Secret Flying publish fares that never reach RSS, and Secret Flying hard-blocks
Cloudflare Worker IPs (403), so email is the *only* route in.

## Setup (needs your Cloudflare dashboard — Claude can't do this part)

1. **Deploy the worker**

   ```bash
   cd workers/email-ingest
   npx wrangler deploy
   ```

2. **Give it the shared secret** — the same value as `INGEST_SECRET` (or
   `CRON_SECRET`) on the Pages project:

   ```bash
   npx wrangler secret put INGEST_SECRET
   ```

3. **Route mail to it.** Cloudflare dashboard → your domain → **Email** →
   **Email Routing** → enable, then add a custom address
   `deals@mrcheapflights.ie` with action **Send to a Worker → email-ingest**.

4. **Subscribe `deals@mrcheapflights.ie`** to the newsletters you want:
   Jack's Flight Club, Secret Flying, Going, Travel-Dealz, Fly4Free,
   HolidayPirates. Only senders in the `email_sources` table are accepted —
   anything else is refused, so a spoofed sender can't inject deals.

## Checking it works

Candidates land in the pipeline queue tagged with the newsletter's name.
`op_log` records an `email-ingest` row per message (parsed / inserted /
duplicates / multi_origin), and the morning digest shows it alongside the other
automations.

To test without waiting for a newsletter, POST a sample directly:

```bash
curl -X POST https://mrcheapflights.ie/api/ingest/email \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"from":"deals@jacksflightclub.com","subject":"Dublin to Lisbon for €29","html":"<p>Dublin to Lisbon for €29 return, travel 12–19 Nov</p>"}'
```
