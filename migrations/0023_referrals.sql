-- Referral growth loop. Every subscriber's existing member_token doubles as
-- their referral token: /r/<token>. A referred signup is tagged with who sent
-- them, the referrer is credited, and every 3 referrals grants 30 premium days
-- (same time-based premium mechanism as promo codes — no Stripe).
ALTER TABLE subscribers ADD COLUMN referred_by TEXT;                              -- referrer's member_token
ALTER TABLE subscribers ADD COLUMN referral_count INTEGER NOT NULL DEFAULT 0;     -- how many they've referred
ALTER TABLE subscribers ADD COLUMN referral_rewarded INTEGER NOT NULL DEFAULT 0;  -- reward grants already given
CREATE INDEX IF NOT EXISTS idx_subscribers_referred_by ON subscribers(referred_by);
