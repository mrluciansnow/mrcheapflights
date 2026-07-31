-- Creative-level attribution. Campaign attribution (subscribers.source =
-- campaigns.slug) tells us WHICH CAMPAIGN drove a signup; it can't tell us
-- which AD CREATIVE did. Each ad_creatives variant now gets its own tracked
-- link /c/<slug>?v=<variant>, so a signup carries the winning variant too.
--
-- That closes the loop on the AI-written ad copy: per-variant CPA, and an
-- evidence-based answer to "which hook actually works?" instead of a guess.
ALTER TABLE subscribers ADD COLUMN source_variant INTEGER;
CREATE INDEX IF NOT EXISTS idx_subscribers_source_variant
  ON subscribers(source, source_variant);
