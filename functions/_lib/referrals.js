// Referral loop. Each subscriber has a dedicated referral_code (/r/<code>).
// When a brand-new subscriber joins carrying a referrer's code, we tag them,
// credit the referrer, and grant premium days each time the referrer crosses
// another REFERRALS_PER_REWARD multiple. Premium is time-based (current_period_end),
// exactly like promo codes — no Stripe involved.
//
// SECURITY: the referral code is deliberately NOT member_token. member_token is a
// capability credential (/api/unsubscribe?token=… opts a person out), and a
// referral link is meant to be shared publicly — so they must never be the same
// value. referral_code grants attribution and nothing else. See migration 0024.

import { randomHex } from './auth.js';

const REFERRALS_PER_REWARD = 3;
const REWARD_DAYS = 30;
export const REFERRAL_TERMS = { perReward: REFERRALS_PER_REWARD, rewardDays: REWARD_DAYS };

// 20 hex chars, matching the migration's backfill shape.
export const REFERRAL_CODE_RE = /^[a-f0-9]{20}$/;

/** Fetch (or lazily create) a subscriber's referral code. Never throws; returns
 *  null if it can't be established, in which case callers simply omit the link. */
export async function ensureReferralCode(env, subscriberId) {
  try {
    if (!subscriberId) return null;
    const row = await env.DB.prepare('SELECT referral_code FROM subscribers WHERE id=?').bind(subscriberId).first();
    if (row?.referral_code) return row.referral_code;
    // Retry a couple of times in the (vanishingly unlikely) event of collision.
    for (let i = 0; i < 3; i++) {
      const code = randomHex(10); // 10 bytes → 20 hex chars
      const res = await env.DB.prepare(
        'UPDATE subscribers SET referral_code=? WHERE id=? AND referral_code IS NULL'
      ).bind(code, subscriberId).run().catch(() => null);
      if ((res?.meta?.changes ?? 0) > 0) return code;
      const again = await env.DB.prepare('SELECT referral_code FROM subscribers WHERE id=?').bind(subscriberId).first();
      if (again?.referral_code) return again.referral_code;
    }
    return null;
  } catch { return null; }
}

/** Best-effort — called from signup's waitUntil, must never throw or block. Only
 *  runs for a genuinely NEW subscriber (caller guards on that). Returns a small
 *  summary for logging/tests. */
export async function creditReferral(env, { newSubId, refCode }) {
  try {
    if (!refCode || !newSubId) return { credited: false, reason: 'no ref' };

    const referrer = await env.DB.prepare(
      'SELECT id, current_period_end, referral_count, referral_rewarded FROM subscribers WHERE referral_code=?'
    ).bind(refCode).first();
    if (!referrer) return { credited: false, reason: 'unknown referrer' };
    // Self-referral: the code belongs to the very subscriber who just signed up.
    if (referrer.id === newSubId) return { credited: false, reason: 'self-referral' };

    // Tag the newcomer once (never re-attribute an already-referred subscriber).
    const tag = await env.DB.prepare(
      'UPDATE subscribers SET referred_by=? WHERE id=? AND referred_by IS NULL'
    ).bind(refCode, newSubId).run();
    if ((tag?.meta?.changes ?? 0) === 0) return { credited: false, reason: 'already referred' };

    // Credit the referrer; grant premium each time they pass another multiple.
    const newCount = (referrer.referral_count || 0) + 1;
    const rewardsDue = Math.floor(newCount / REFERRALS_PER_REWARD);
    const already = referrer.referral_rewarded || 0;
    const now = Math.floor(Date.now() / 1000);

    if (rewardsDue > already) {
      const grants = rewardsDue - already;
      const from = referrer.current_period_end && referrer.current_period_end > now ? referrer.current_period_end : now;
      const newEnd = from + grants * REWARD_DAYS * 86400;
      await env.DB.prepare(
        `UPDATE subscribers SET referral_count=?, referral_rewarded=?, tier='premium',
           current_period_end=?, updated_at=unixepoch() WHERE id=?`
      ).bind(newCount, rewardsDue, newEnd, referrer.id).run();
      return { credited: true, referrerId: referrer.id, count: newCount, rewarded: true, grants, premium_until: newEnd };
    }

    await env.DB.prepare('UPDATE subscribers SET referral_count=?, updated_at=unixepoch() WHERE id=?')
      .bind(newCount, referrer.id).run();
    return { credited: true, referrerId: referrer.id, count: newCount, rewarded: false, toNextReward: REFERRALS_PER_REWARD - (newCount % REFERRALS_PER_REWARD) };
  } catch (e) {
    return { credited: false, reason: 'error:' + (e.message || 'unknown') };
  }
}
