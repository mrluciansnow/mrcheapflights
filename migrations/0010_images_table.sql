-- Generated deal images (Workers AI flux-1-schnell). Stored as raw bytes in
-- D1 because R2 isn't enabled on the account yet (dashboard action, code
-- 10042). The /images/* serving route abstracts storage — when R2 is enabled,
-- swap the read/write in generate-image.js + images/[[path]].js and drop this.
-- Volume is tiny: one ~150KB JPEG per published deal, purged with the deal.
CREATE TABLE IF NOT EXISTS images (
  key          TEXT PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes        BLOB NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
