-- Ad-campaign automation. A control surface + audit trail for programmatic
-- campaigns on Meta (Facebook/Instagram) and TikTok. The site owns a local
-- mirror of each campaign so spend/CPA can be joined against the internal
-- /c/ attribution data — the platform is the executor, D1 is the brain.
--
-- SAFETY MODEL (enforced in _lib/ads-engine.js, surfaced in the admin UI):
--   * Campaigns are created PAUSED. The service never sets one ACTIVE on its
--     own — going live (i.e. spending money) is a human action in the
--     platform's own Ads Manager, or an explicit admin click.
--   * Nothing writes to a platform unless ADS_LIVE=1 AND a token is present;
--     otherwise every action is a dry-run (planned + logged, never sent).
--   * A hard daily-budget ceiling (ADS_MAX_DAILY_BUDGET) is refused above.
--   * The automated guardrail only ever PAUSES over-target campaigns (spend
--     goes down, never up) unless ADS_ALLOW_SCALE=1.

-- Non-secret per-platform connection config. Tokens live in env secrets
-- (META_ACCESS_TOKEN / TIKTOK_ACCESS_TOKEN) and are NEVER stored here; this
-- row only holds the identifiers needed to address the right ad account.
CREATE TABLE IF NOT EXISTS ad_accounts (
  platform     TEXT PRIMARY KEY,              -- 'meta' | 'tiktok'
  account_id   TEXT,                          -- act_<id> (Meta) / advertiser_id (TikTok)
  page_id      TEXT,                          -- Meta Page backing the ads (optional)
  pixel_id     TEXT,                          -- conversion pixel (optional)
  status       TEXT NOT NULL DEFAULT 'disconnected', -- disconnected | connected
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Local mirror + control record for each campaign.
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  platform          TEXT    NOT NULL,           -- 'meta' | 'tiktok'
  ext_campaign_id   TEXT,                       -- id returned by the platform (NULL until launched)
  ext_adset_id      TEXT,                       -- ad set / ad group id
  name              TEXT    NOT NULL,
  objective         TEXT    NOT NULL DEFAULT 'traffic', -- traffic | reach | engagement
  status            TEXT    NOT NULL DEFAULT 'draft',
                    -- draft | paused | active | archived | error
  daily_budget_cents INTEGER NOT NULL DEFAULT 0,
  target_cpa_cents  INTEGER,                    -- kill threshold for the guardrail
  campaign_slug     TEXT,                       -- links to campaigns.slug (/c/<slug>) for CPA
  landing_url       TEXT,                       -- the /c/<slug> destination
  region            TEXT    NOT NULL DEFAULT 'ie', -- ie | uk (currency + domain)
  dry_run           INTEGER NOT NULL DEFAULT 1,  -- 1 = never sent to a platform
  last_synced_at    INTEGER,
  last_spend_cents  INTEGER NOT NULL DEFAULT 0,  -- from platform insights
  last_impressions  INTEGER NOT NULL DEFAULT 0,
  last_clicks       INTEGER NOT NULL DEFAULT 0,
  last_results      INTEGER NOT NULL DEFAULT 0,  -- platform-reported results (link clicks/conversions)
  note              TEXT,                        -- last engine note (e.g. why paused)
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status ON ad_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_slug ON ad_campaigns(campaign_slug);

-- Append-only audit of every action the engine takes — the answer to "what did
-- the robot do?". dry_run distinguishes planned-only from actually-sent.
CREATE TABLE IF NOT EXISTS ad_actions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  INTEGER,                         -- NULL for account-level actions
  platform     TEXT,
  action       TEXT NOT NULL,                   -- plan | create | pause | activate | scale | sync | guardrail | error
  ok           INTEGER NOT NULL DEFAULT 1,
  dry_run      INTEGER NOT NULL DEFAULT 1,
  detail       TEXT,                            -- JSON: request summary / response / reason
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ad_actions_campaign ON ad_actions(campaign_id, created_at);
