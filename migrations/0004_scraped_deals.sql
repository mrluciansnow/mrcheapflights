-- Deal scraping system — stores externally-scraped deals pending admin review.
-- Admin can approve (copies to `deals` table) or reject each row.

CREATE TABLE scraped_deals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT    NOT NULL,                -- e.g. "Secret Flying", "Fly4Free"
  source_url  TEXT    NOT NULL DEFAULT '#',    -- origin URL
  flag        TEXT    NOT NULL DEFAULT '✈️',
  route       TEXT    NOT NULL,
  dates       TEXT    NOT NULL DEFAULT '',
  price       TEXT    NOT NULL,
  badge       TEXT    NOT NULL DEFAULT '🔥 Hot',
  region      TEXT    NOT NULL DEFAULT 'ie',
  raw_snippet TEXT,                             -- raw text/html snippet for reference
  status      TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_scraped_status ON scraped_deals(status);
CREATE INDEX idx_scraped_region ON scraped_deals(region);
CREATE INDEX idx_scraped_source ON scraped_deals(source_name);
