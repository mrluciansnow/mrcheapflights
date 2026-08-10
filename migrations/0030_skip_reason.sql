-- Why a scored candidate could not be promoted.
--
-- enrich-pending silently `continue`d past deals whose source_url wasn't https
-- (an SSRF guard), so a deal scoring 90 could sit pending for ever with nothing
-- explaining why — invisible in the UI and re-queried on every run.
ALTER TABLE scraped_deals ADD COLUMN skip_reason TEXT;
