-- Mr Cheap Flights — initial schema
-- Replaces per-browser localStorage with a real shared store.

CREATE TABLE deals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  flag        TEXT    NOT NULL DEFAULT '✈️',
  route       TEXT    NOT NULL,
  dates       TEXT    NOT NULL DEFAULT '',
  price       TEXT    NOT NULL,              -- display string e.g. "€47"
  badge       TEXT    NOT NULL DEFAULT '🔥 Hot',
  url         TEXT    NOT NULL DEFAULT '#',
  expiry      TEXT,                          -- 'YYYY-MM-DD' or NULL
  slug        TEXT    NOT NULL,
  region      TEXT    NOT NULL DEFAULT 'ie', -- 'ie' | 'uk'
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_deals_region ON deals(region);
CREATE INDEX idx_deals_expiry ON deals(expiry);
CREATE UNIQUE INDEX idx_deals_slug_region ON deals(slug, region);

-- Public-safe key/value settings. Exposed via public GET /api/settings.
-- Secrets (admin password hash, Stripe secret key, signing secrets) never go here.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- One row per email. Tracks free vs premium and Stripe reconciliation state.
CREATE TABLE subscribers (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  email                  TEXT    NOT NULL,
  region                 TEXT    NOT NULL DEFAULT 'ie',
  tier                   TEXT    NOT NULL DEFAULT 'free',   -- 'free' | 'premium'
  member_token           TEXT    NOT NULL,                  -- opaque value referenced by the mcf_member cookie
  name                   TEXT,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  subscription_status    TEXT,    -- active|trialing|past_due|canceled|incomplete|...
  current_period_end     INTEGER, -- unix seconds; premium considered valid while now < this
  created_at             INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at             INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_subscribers_email ON subscribers(email);
CREATE UNIQUE INDEX idx_subscribers_token ON subscribers(member_token);
CREATE INDEX idx_subscribers_customer ON subscribers(stripe_customer_id);
CREATE INDEX idx_subscribers_subscription ON subscribers(stripe_subscription_id);

-- Single-row table for the admin password hash. Deliberately separate from
-- `settings` so it can never be exposed through the public settings endpoint.
CREATE TABLE admin_auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Stripe webhook idempotency guard (Stripe retries deliveries).
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,     -- Stripe event id (evt_...)
  type         TEXT NOT NULL,
  processed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
