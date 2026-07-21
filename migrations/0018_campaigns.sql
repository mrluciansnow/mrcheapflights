-- Sponsored-marketing attribution. Every campaign (paid ad or influencer deal)
-- gets a tracked link /c/<slug>; signups that arrive through it are tagged with
-- their source so spend can be measured against subscribers gained.
CREATE TABLE IF NOT EXISTS campaigns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,       -- URL token: /c/<slug>
  name          TEXT    NOT NULL,              -- human label
  platform      TEXT    NOT NULL DEFAULT 'tiktok', -- tiktok | instagram | other
  type          TEXT    NOT NULL DEFAULT 'ad', -- ad | influencer
  creator       TEXT,                          -- @handle when influencer
  spend_cents   INTEGER NOT NULL DEFAULT 0,    -- logged spend (for CPA)
  headline      TEXT,                          -- landing-page hook override
  region        TEXT    NOT NULL DEFAULT 'ie', -- ie | uk
  active        INTEGER NOT NULL DEFAULT 1,
  visits        INTEGER NOT NULL DEFAULT 0,    -- landing-page hits
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(active);

-- Where a subscriber came from ('<slug>' for tracked campaigns, NULL organic).
ALTER TABLE subscribers ADD COLUMN source TEXT;
CREATE INDEX IF NOT EXISTS idx_subscribers_source ON subscribers(source);
