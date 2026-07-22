-- Ad automation, round 2: activation timestamp (for simulated spend accrual +
-- "live since" display) and AI-generated ad creative per campaign.

-- When a campaign was first activated. Drives the sandbox spend simulation and
-- a "live since" label; harmless for real campaigns.
ALTER TABLE ad_campaigns ADD COLUMN activated_at INTEGER;

-- AI-written ad copy variants for a campaign (the "marketing design" layer).
-- One row per variant; a campaign can hold several A/B options.
CREATE TABLE IF NOT EXISTS ad_creatives (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  INTEGER NOT NULL,
  platform     TEXT    NOT NULL,           -- meta | tiktok
  variant      INTEGER NOT NULL DEFAULT 0, -- 0,1,2… A/B index
  primary_text TEXT,                        -- Meta primary text / TikTok caption
  headline     TEXT,                        -- Meta headline / TikTok hook
  description  TEXT,                        -- Meta link description
  cta          TEXT,                        -- call-to-action label
  concept      TEXT,                        -- one-line visual/angle direction
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_campaign ON ad_creatives(campaign_id);
