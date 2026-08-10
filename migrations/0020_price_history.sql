-- Price time-series per deal, fed by the fare-verification engine (every 8h it
-- pulls a real fare from Travelpayouts/Google). Powers the deal-page trend
-- badge ("at a 12-day low"), the member sparkline, and new-low drop detection.
-- De-duplicated: a new row is only written when the price actually moves.
CREATE TABLE IF NOT EXISTS price_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id    INTEGER NOT NULL,
  source     TEXT    NOT NULL,          -- 'travelpayouts' | 'google'
  price      REAL    NOT NULL,
  currency   TEXT,
  checked_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ph_deal ON price_history(deal_id, checked_at);
