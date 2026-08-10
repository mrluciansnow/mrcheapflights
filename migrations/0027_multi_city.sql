-- Multi-city deals: one destination, priced from every departure city.
--
-- Until now a deal was a single "Origin → Dest" string, so we couldn't answer
-- the question every reader actually has: "what does that cost from MY
-- airport?" This adds a price row per origin, which unlocks three things at
-- once — the "check from other cities" control on the site, per-city Instagram
-- carousel slides, and better alerts (match a watcher's home airport).
--
-- Existing single-origin deals are simply the one-row case; nothing breaks.
CREATE TABLE IF NOT EXISTS deal_origins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id      INTEGER NOT NULL,
  origin_city  TEXT    NOT NULL,             -- display name, e.g. "Cork"
  origin_iata  TEXT    NOT NULL,             -- e.g. "ORK"
  price        REAL,                          -- numeric, in `currency`
  currency     TEXT    NOT NULL DEFAULT 'EUR',
  depart_date  TEXT,                          -- 'YYYY-MM-DD' when known
  return_date  TEXT,
  airline      TEXT,
  stops        INTEGER,
  book_url     TEXT,                          -- affiliate-wrapped search link
  source       TEXT    NOT NULL DEFAULT 'travelpayouts', -- travelpayouts | scraped | manual
  checked_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(deal_id, origin_iata)
);
CREATE INDEX IF NOT EXISTS idx_deal_origins_deal ON deal_origins(deal_id, price);

-- When the fan-out last ran for a deal, so the cron can prioritise the stalest
-- and avoid re-pricing the same deal every run.
ALTER TABLE deals ADD COLUMN origins_synced_at INTEGER;
