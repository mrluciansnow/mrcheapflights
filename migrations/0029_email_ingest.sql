-- Email newsletter ingestion.
--
-- Newsletters often quote one destination from several departure cities
-- ("London £229 · Manchester £249 · Dublin €279"). That's the multi-city shape
-- we want, but deal_origins keys on deals.id and a candidate has no deal row
-- until it's approved — so the origins ride along on the candidate as JSON and
-- are unpacked into deal_origins at approval.
ALTER TABLE scraped_deals ADD COLUMN origins_json TEXT;

-- Which newsletters we trust. Ingestion refuses anything not listed here, so a
-- spoofed sender can't inject deals. Seeded with the ones worth reading.
CREATE TABLE IF NOT EXISTS email_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender      TEXT    NOT NULL UNIQUE,   -- lowercase domain or full address
  name        TEXT    NOT NULL,          -- becomes scraped_deals.source_name
  region      TEXT,                       -- 'ie' | 'uk' | NULL = infer per deal
  active      INTEGER NOT NULL DEFAULT 1,
  last_seen   INTEGER,
  deals_found INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO email_sources (sender, name, region) VALUES
  ('jacksflightclub.com', 'Jack''s Flight Club', NULL),
  ('secretflying.com',    'Secret Flying',       NULL),
  ('travel-dealz.com',    'Travel-Dealz',        NULL),
  ('travel-dealz.eu',     'Travel-Dealz',        NULL),
  ('going.com',           'Going',               NULL),
  ('fly4free.com',        'Fly4Free',            NULL),
  ('holidaypirates.com',  'HolidayPirates',      NULL);
