-- Adds a draft/live lifecycle to deals so the content pipeline dashboard can
-- stage candidate deals for review before they go out to real visitors.
-- Existing deals default to 'live' -- no behaviour change for the current site.
ALTER TABLE deals ADD COLUMN status TEXT NOT NULL DEFAULT 'live';
ALTER TABLE deals ADD COLUMN pipeline_style TEXT;
ALTER TABLE deals ADD COLUMN pipeline_copy TEXT;
-- Candidate-deal metadata used only by the content pipeline dashboard --
-- not displayed on the live site, just informs style/copy generation there.
ALTER TABLE deals ADD COLUMN was_price TEXT;
ALTER TABLE deals ADD COLUMN airline TEXT;
ALTER TABLE deals ADD COLUMN dest_type TEXT;
CREATE INDEX idx_deals_status ON deals(status);
