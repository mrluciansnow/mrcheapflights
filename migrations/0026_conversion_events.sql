-- Server-side conversion events (Meta CAPI / TikTok Events API).
--
-- When someone signs up after clicking an ad, the platform only knows it if we
-- tell it. Server-side events feed the optimisation algorithm, which is the
-- biggest single lever on CPA — and they survive ad-blockers and ITP, which
-- browser pixels don't.
--
-- This table is the AUDIT TRAIL: every event we considered, whether it was
-- sent, skipped (disabled/sandbox/not attributed) or errored. event_id is the
-- deduplication key — the same value a browser pixel would send, so a platform
-- receiving both counts one conversion, not two.
--
-- PRIVACY: no raw email is ever stored here or transmitted. Emails are
-- SHA-256 hashed before leaving the box (the platforms hash their side the same
-- way). See _lib/conversions.js for the consent/scope rules.
CREATE TABLE IF NOT EXISTS conversion_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT    NOT NULL UNIQUE,      -- dedup key (shared with any browser pixel)
  platform       TEXT    NOT NULL,             -- meta | tiktok
  event_name     TEXT    NOT NULL,             -- CompleteRegistration | Subscribe
  subscriber_id  INTEGER,
  source         TEXT,                         -- campaign slug that drove it
  source_variant INTEGER,                      -- winning creative variant
  status         TEXT    NOT NULL DEFAULT 'pending', -- sent | skipped | error
  detail         TEXT,                         -- reason / platform response summary
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_conversion_events_status ON conversion_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_conversion_events_source ON conversion_events(source);
