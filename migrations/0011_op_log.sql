-- Operations log — every automation run (scrape/enrich/newsletter/images/
-- cleanup/publish) records one row. Surfaced in the admin morning briefing
-- so failures are visible without opening cron-job.org. Purged after 30 days
-- by the nightly cleanup.
CREATE TABLE IF NOT EXISTS op_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL,              -- scrape|enrich|newsletter|images|cleanup|publish
  ok         INTEGER NOT NULL DEFAULT 1,    -- 1 success, 0 failure/degraded
  detail     TEXT,                          -- JSON summary, clipped
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_op_log_created ON op_log(created_at);
