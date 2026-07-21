-- One-shot welcome email marker — set when the branded welcome has been
-- delivered, so repeat signups/watches never double-send.
ALTER TABLE subscribers ADD COLUMN welcomed_at INTEGER;
