-- Fare verification results — one row per (deal, source), upserted on every
-- check. Powers the "✓ Verified flight details" block on listings: guests see
-- a blurred teaser, logged-in members see the data, premium badges stay
-- premium-only. Sources: 'travelpayouts' (cached Aviasales fares, free) and
-- 'google' (real Google Flights via SerpApi).
CREATE TABLE IF NOT EXISTS fare_checks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id      INTEGER NOT NULL,
  source       TEXT    NOT NULL,          -- 'travelpayouts' | 'google'
  status       TEXT    NOT NULL,          -- 'verified' | 'price_changed' | 'not_found' | 'error'
  price_found  REAL,                      -- numeric fare found (NULL when not_found/error)
  currency     TEXT,                      -- EUR | GBP
  depart_date  TEXT,                      -- YYYY-MM-DD of the checked itinerary
  return_date  TEXT,
  airline      TEXT,
  stops        INTEGER,                   -- 0 = direct
  duration_min INTEGER,                   -- total outbound duration, minutes
  url          TEXT,                      -- deep link (Google Flights / affiliate search)
  brief        TEXT,                      -- one-line human summary for the listing
  checked_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(deal_id, source)
);
CREATE INDEX IF NOT EXISTS idx_fare_deal ON fare_checks(deal_id);
