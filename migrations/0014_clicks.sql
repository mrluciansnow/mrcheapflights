-- Booking-intent click log. Powers revenue attribution — which deals and
-- destinations actually drive booking/fares clicks — surfaced in the morning
-- briefing. Pruned after 90 days by the nightly cleanup.
CREATE TABLE IF NOT EXISTS clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL,          -- 'book' | 'fares'
  deal_id    INTEGER,                   -- nullable (hub fares clicks have no deal)
  dest_slug  TEXT,                      -- destination hub slug, when known
  region     TEXT,                      -- ie | uk
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_clicks_created ON clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_clicks_dest ON clicks(dest_slug);
