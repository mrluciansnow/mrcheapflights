-- AI enrichment columns on scraped_deals.
-- Added by the enrich-pending endpoint (Claude Haiku classification pass).
ALTER TABLE scraped_deals ADD COLUMN confidence INTEGER;   -- 0-100; NULL = not yet enriched
ALTER TABLE scraped_deals ADD COLUMN dest_type TEXT;       -- sun|city|longhaul|wintersun
ALTER TABLE scraped_deals ADD COLUMN ai_copy TEXT;         -- reserved for future server-side copy
