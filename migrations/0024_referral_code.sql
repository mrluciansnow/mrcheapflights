-- SECURITY FIX: decouple the referral token from member_token.
--
-- 0023 made /r/<member_token> the share link, but member_token is a CAPABILITY
-- credential: /api/unsubscribe?token=<member_token> opts that person out of the
-- newsletter (and &dest= kills a price alert). Since a referral link is meant to
-- be posted publicly, anyone reading a shared link could silently unsubscribe
-- the sharer and disable their alerts.
--
-- Fix: every subscriber gets a separate, non-privileged referral_code used for
-- /r/<code>. Sharing it grants attribution and nothing else. member_token goes
-- back to being private (emails + signed cookie only).
ALTER TABLE subscribers ADD COLUMN referral_code TEXT;

-- 20 lowercase hex chars (80 bits) — not enumerable, and deliberately a
-- different length/shape from member_token (48) so the two can't be confused.
-- randomblob() is evaluated per row, so each subscriber gets a distinct code.
UPDATE subscribers SET referral_code = lower(hex(randomblob(10))) WHERE referral_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_referral_code ON subscribers(referral_code);

-- referred_by stored the referrer's member_token in 0023. No real referrals
-- exist yet (verified: 0 rows with referred_by/referral_count), so re-point it
-- at referral_code semantics with a clean slate rather than a lossy migration.
UPDATE subscribers SET referred_by = NULL WHERE referred_by IS NOT NULL;
