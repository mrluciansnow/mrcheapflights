-- Promo codes = comped premium trials. An influencer shares a code; redeeming
-- it grants N days of premium WITHOUT Stripe (premium is time-based:
-- current_period_end in the future). Measurable + a real reason for their
-- audience to act.
CREATE TABLE IF NOT EXISTS promo_codes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT    NOT NULL UNIQUE,        -- stored uppercase
  campaign_id     INTEGER,                        -- optional link to campaigns.id
  trial_days      INTEGER NOT NULL DEFAULT 30,
  max_redemptions INTEGER,                        -- NULL = unlimited
  redeemed_count  INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- One redemption per (code, email) — stops the same person re-extending forever.
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL,
  email         TEXT    NOT NULL,
  subscriber_id INTEGER,
  redeemed_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(code, email)
);
