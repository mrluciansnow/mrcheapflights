// Referral loop. A subscriber's member_token is their referral token (/r/<token>).
// When a brand-new subscriber joins carrying a referrer's token, we tag them,
// credit the referrer, and grant premium days each time the referrer crosses
// another REFERRALS_PER_REWARD multiple. Premium is time-based (current_period_end),
// exactly like promo codes — no Stripe involved.

const REFERRALS_PER_REWARD = 3;
const REWARD_DAYS = 30;
export const REFERRAL_TERMS = { perReward: REFERRALS_PER_REWARD, rewardDays: REWARD_DAYS };

/** Best-effort — called from signup's waitUntil, must never throw or block. Only
 *  runs for a genuinely NEW subscriber (caller guards on that). Returns a small
 *  summary for logging/tests. */
export async function creditReferral(env, { newSubId, newToken, refToken }) {
  try {
    if (!refToken || !newSubId) return { credited: false, reason: 'no ref' };
    if (refToken === newToken) return { credited: false, reason: 'self-referral' };

    const referrer = await env.DB.prepare(
      'SELECT id, member_token, current_period_end, referral_count, referral_rewarded FROM subscribers WHERE member_token=?'
    ).bind(refToken).first();
    if (!referrer || referrer.id === newSubId) return { credited: false, reason: 'unknown referrer' };

    // Tag the newcomer once (never re-attribute an already-referred subscriber).
    const tag = await env.DB.prepare(
      'UPDATE subscribers SET referred_by=? WHERE id=? AND referred_by IS NULL'
    ).bind(refToken, newSubId).run();
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
