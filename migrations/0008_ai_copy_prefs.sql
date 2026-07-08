-- AI-generated caption variants travel from enrichment to the pipeline:
-- scraped_deals.ai_copy (already exists, 0006) → deals.ai_copy on approval.
-- subscribers.prefs reserved for server-side digest personalisation.
ALTER TABLE deals ADD COLUMN ai_copy TEXT;
ALTER TABLE subscribers ADD COLUMN prefs TEXT;
