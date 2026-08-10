-- Programmatic-SEO destination hub pages: cached AI-written guide content +
-- hero image per destination. Static metadata (name/country/iata/type/
-- landmark) lives in code (_lib/destinations.js); only the expensive
-- generated content is cached here, keyed by the registry slug.
CREATE TABLE IF NOT EXISTS destination_content (
  slug        TEXT PRIMARY KEY,          -- matches DESTINATIONS key, e.g. 'barcelona'
  intro       TEXT,                      -- 2-3 sentence evergreen intro (HTML-safe plain text)
  guide_json  TEXT,                      -- JSON: { best_time, airlines, price_from, highlights[], faq[] }
  image_url   TEXT,                      -- /images/dest/<slug>-<ts>.jpg
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
