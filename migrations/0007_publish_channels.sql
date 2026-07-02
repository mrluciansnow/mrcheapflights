-- Phase 4 publishing layer: per-channel publish state (idempotent retries)
-- and newsletter opt-out. Mirrors the pack's posts.published_* booleans,
-- adapted onto the deals table (our unit of publishing).
ALTER TABLE deals ADD COLUMN published_email  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deals ADD COLUMN published_social INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscribers ADD COLUMN newsletter_opt_out INTEGER NOT NULL DEFAULT 0;
