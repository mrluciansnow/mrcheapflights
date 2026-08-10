-- Destination price alerts. A subscriber opts in to a destination (from a
-- /flights-to hub) and gets a targeted email the moment a matching live deal
-- appears — the retention engine that turns SEO traffic into repeat visitors.
CREATE TABLE IF NOT EXISTS watchlists (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id   INTEGER,                       -- subscribers.id
  email           TEXT    NOT NULL,              -- denormalised for sending
  member_token    TEXT    NOT NULL,              -- for one-click manage/opt-out
  region          TEXT    NOT NULL DEFAULT 'ie', -- ie | uk
  dest_slug       TEXT    NOT NULL,              -- destinations registry slug
  max_price       INTEGER,                       -- optional cap (region currency), NULL = any
  last_alerted_at INTEGER,                       -- throttle: at most one alert / 12h
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_watch_match ON watchlists(active, region, dest_slug);
CREATE INDEX IF NOT EXISTS idx_watch_token ON watchlists(member_token);
-- One active watch per (email, destination) — re-subscribing just reactivates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_uniq ON watchlists(email, dest_slug);

-- Alert-sent flag so a deal is only ever alerted on once.
ALTER TABLE deals ADD COLUMN alerted INTEGER NOT NULL DEFAULT 0;
