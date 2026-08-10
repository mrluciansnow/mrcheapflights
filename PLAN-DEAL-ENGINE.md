# Deal Engine — scraping, searching & multi-city architecture

The plan for what deal discovery should become. Today's scraper is a single-city
RSS reader; the target is a multi-source, multi-city deal engine whose output
feeds the site, the alerts, and Instagram carousels from one shared model.

Status legend: ✅ built · 🔨 in progress · ⬜ planned

---

## 1. Why change

Three limits in the current design, all confirmed by audit:

1. **It invents data.** `parseDealTitle()` defaults the origin to Dublin/London
   when its `from X to Y` regex misses, so *"Cork to Lisbon"* is published as
   *"Dublin → Lisbon"*. It also accepts junk destinations (*"Dublin → Book
   Now"*) and rejects valid deals (*"London to Malaga £25 return"*).
2. **One deal = one city.** A deal is a single `"Origin → Dest"` string, so we
   can't answer the question every reader actually has — *"what does that cost
   from **my** airport?"*
3. **Narrow intake.** Four RSS feeds. The best deals (Jack's Flight Club,
   Secret Flying) arrive by **email**, and Secret Flying blocks Worker IPs
   outright, so HTTP scraping can't reach them.

---

## 2. Target shape

```
   SOURCES              NORMALISE            ENRICH              FAN-OUT
┌──────────────┐    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ RSS feeds  ✅ │    │              │   │ AI score  ✅  │   │ price the    │
│ Email ⬜      │───▶│ one canonical │──▶│ AI copy   ✅  │──▶│ same dest    │
│ HTML pages ⬜ │    │ candidate    │   │ dedupe/rank  │   │ from EVERY   │
│ TP API     ✅ │    │ shape        │   │              │   │ origin ⬜     │
└──────────────┘    └──────────────┘   └──────────────┘   └──────┬───────┘
                                                                 │
                          ┌──────────────────────────────────────┤
                          ▼                  ▼                   ▼
                    ┌───────────┐     ┌───────────┐       ┌───────────┐
                    │ website   │     │ alerts +  │       │ IG carousel│
                    │ + compare │     │ newsletter│       │ 1 slide per│
                    │ button ⬜  │     │        ✅  │       │ city ⬜     │
                    └───────────┘     └───────────┘       └───────────┘
```

The key structural change: **a deal is a destination, not a route.** Origins
become rows hanging off it.

---

## 3. Sources

| Source | Type | Status | Notes |
|---|---|---|---|
| Fly4Free, Travel-Dealz, The Flight Deal, Holiday Pirates | RSS | ✅ | Each currently fetched **twice** (once per region) — fix to one fetch, two filters |
| **Jack's Flight Club** | Email | ⬜ | Members' newsletter; several deals per mail, often several origins per deal |
| **Secret Flying** | Email | ⬜ | HTTP blocked (403 on Worker IPs) — email is the only viable route |
| Travelpayouts Data API | API | ✅ | Already used for verification; becomes the **fan-out** engine |
| Airline sale pages | HTML | ⬜ | Ryanair/Aer Lingus/easyJet sale pages, lowest priority |

**Email ingestion** (task #11) is the highest-value addition: Cloudflare Email
Routing → Email Worker on `deals@mrcheapflights.ie` → HTML-email parser →
`scraped_deals`. Sender allowlist so only real newsletters are trusted.
*Needs the user to enable Email Routing and subscribe `deals@` to each list.*

---

## 4. Canonical candidate shape

Every source normalises to one shape before enrichment:

```js
{
  destCity, destIata, destCountryFlag,     // resolved, or the deal is REJECTED
  origins: [ { city, iata, price, currency } ],   // ≥1; multi-city sources fill many
  departFrom, departTo,                    // travel window (parsed, may be null)
  badge, sourceName, sourceUrl, snippet, region
}
```

Two rules that fix the correctness problems:

- **Resolve or reject.** Origin and destination must resolve against
  `CITY_IATA`. Nothing is ever defaulted or guessed — an unresolvable place
  means the candidate is dropped, not published with invented data.
- **Currency follows region.** Prefer the price whose symbol matches the
  region (€ for `ie`, £ for `uk`); normalise before any threshold comparison.

---

## 5. Multi-city model

```sql
deals            -- the destination (existing table; route stays for display)
deal_origins     -- NEW: one row per departure city
  deal_id, origin_city, origin_iata, price_cents, currency,
  book_url, source, found_at, is_cheapest
```

Existing single-origin deals become a one-row case — nothing breaks.

**Fan-out** (task #13): when a deal lands, price the same destination from every
IE/UK origin via Travelpayouts (free, already integrated) and write a
`deal_origins` row each. Budget discipline as in `_lib/fares.js`: TP only, never
SerpApi, so fan-out costs nothing.

Origin set: Dublin, Cork, Shannon, Belfast · London, Manchester, Birmingham,
Edinburgh, Glasgow, Bristol.

---

## 6. What it unlocks

**On the site** (task #14) — a *"Check this fare from other cities"* control on
every deal: same destination, priced from each airport, cheapest first, each
with its own booking link. Gated server-side by tier exactly like fare details
(guest → blurred, free → free detail, premium → full).

**On Instagram** (tasks #15, #16) — a poster **series**: slide 1 the
destination hero, then one slide per departure city with that city's price.
Same template and branding throughout. At publish time the operator chooses:

- **Single image** — one city, as today; or
- **Carousel** — one slide per city, caption naming the cheapest and the range
  (*"from €29 (Dublin) to €54 (Glasgow)"*).

This is the format that actually performs for a deals brand: every follower
sees their own airport in the same post.

---

## 7. Order of work

1. **Correctness first** — tasks #1–#4. The parser is publishing wrong routes
   *right now*; multi-city built on bad extraction just multiplies the error.
2. **Integrity** — #5–#7 (duplicate deals, invisible skips, mid-confidence limbo).
3. **Reach** — #8–#11, email ingestion the prize.
4. **Multi-city** — #12–#16, schema → fan-out → compare button → carousels.
5. **Guardrails** — #18–#19, parser regression tests and a caption/price
   consistency gate, so none of the above silently rots.

Tests come with the parser rewrite, not after it: the bugs in §1 were found by
hand-testing regexes, and nothing currently guards them.
