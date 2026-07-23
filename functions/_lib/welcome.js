// One-shot branded welcome email, sent the first time an address joins —
// via homepage signup OR a destination alert. Fire-and-forget from the
// endpoints (context.waitUntil) so the signup response never waits on Resend.
//
// Transactional, not bulk: gated only on RESEND_API_KEY (NEWSLETTER_ENABLED
// governs the daily digest, not this). welcomed_at guards double-sends.

import { sendEmail } from './email.js';
import { REFERRAL_TERMS } from './referrals.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildWelcomeHtml(siteUrl, unsubUrl, destName, referralUrl) {
  const alertLine = destName
    ? `<div style="background:rgba(0,229,204,0.08);border:1px solid rgba(0,229,204,0.3);border-radius:10px;padding:12px 16px;margin:0 0 18px;">
         <span style="font-family:Arial,sans-serif;font-size:13px;color:#00E5CC;font-weight:bold;">🔔 Your ${esc(destName)} alert is armed</span>
         <div style="font-family:Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px;">The moment a matching fare drops, you'll hear from us — usually within the hour.</div>
       </div>`
    : '';
  const referralBlock = referralUrl
    ? `<div style="background:rgba(255,45,120,0.08);border:1px solid rgba(255,45,120,0.3);border-radius:10px;padding:14px 16px;margin:18px 0 0;text-align:center;">
         <div style="font-family:Arial,sans-serif;font-size:13px;color:#FF6FA5;font-weight:bold;">🎁 Give cheap flights, get Premium free</div>
         <div style="font-family:Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.7);margin:6px 0 10px;line-height:1.6;">Send your link to the group chat. Every ${REFERRAL_TERMS.perReward} mates who join gets you <strong style="color:#fff;">${REFERRAL_TERMS.rewardDays} days of Premium</strong> — verified &amp; mistake fares, the lot.</div>
         <div style="font-family:'Courier New',monospace;font-size:12px;color:#FFD700;background:rgba(255,215,0,0.08);border:1px dashed rgba(255,215,0,0.35);border-radius:8px;padding:9px 10px;word-break:break-all;">${esc(referralUrl)}</div>
       </div>`
    : '';
  return `<div style="background:#060B1F;padding:24px;">
    <div style="text-align:center;padding-bottom:16px;">
      <span style="font-family:Impact,Arial,sans-serif;font-size:26px;color:#FFD700;letter-spacing:1px;">MR CHEAP FLIGHTS ✈</span>
      <div style="font-family:Arial,sans-serif;font-size:12px;color:#00E5CC;letter-spacing:3px;margin-top:2px;">YOU'RE IN — WELCOME TO THE CLUB</div>
    </div>
    <div style="background:#0A0F2E;border-radius:12px;padding:22px;">
      ${alertLine}
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#fff;line-height:1.7;margin:0 0 14px;">
        Here's what happens next:
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:13px;color:rgba(255,255,255,0.75);line-height:1.7;">
        <tr><td style="padding:4px 10px 4px 0;">📬</td><td style="padding:4px 0;"><strong style="color:#fff;">Fresh deals most mornings</strong> — the best fares our robots and humans found, straight to this inbox.</td></tr>
        <tr><td style="padding:4px 10px 4px 0;">🔎</td><td style="padding:4px 0;"><strong style="color:#fff;">Independently verified fares</strong> — we check deals against live Google Flights data before shouting about them.</td></tr>
        <tr><td style="padding:4px 10px 4px 0;">🔔</td><td style="padding:4px 0;"><strong style="color:#fff;">Price alerts</strong> — set a destination on any city page and we'll ping you the moment it drops.</td></tr>
      </table>
      <div style="text-align:center;padding-top:18px;">
        <a href="${esc(siteUrl)}" style="display:inline-block;background:#FFD700;color:#0A0F2E;font-family:Arial,sans-serif;font-weight:bold;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">See today's deals ✈</a>
      </div>
      ${referralBlock}
    </div>
    <div style="text-align:center;font-family:Georgia,serif;font-style:italic;color:#FFD700;font-size:13px;padding:14px;">Cheap never looked this good.</div>
    <div style="text-align:center;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.35);padding-bottom:8px;">
      You're getting this because you signed up at ${esc(siteUrl.replace('https://', ''))}.
      <a href="${esc(unsubUrl)}" style="color:rgba(255,255,255,0.5);">Unsubscribe</a>
    </div>
  </div>`;
}

/** Send the welcome exactly once per subscriber. Never throws. */
export async function sendWelcomeIfNew(env, { subscriberId, email, memberToken, region, destName }) {
  try {
    if (!env.RESEND_API_KEY || !subscriberId) return;
    const row = await env.DB.prepare(
      'SELECT welcomed_at FROM subscribers WHERE id=?'
    ).bind(subscriberId).first();
    if (!row || row.welcomed_at) return;

    const siteUrl = region === 'uk' ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
    const unsubUrl = `${siteUrl}/api/unsubscribe?token=${encodeURIComponent(memberToken)}`;
    const res = await sendEmail(env, {
      to: email,
      subject: destName
        ? `🔔 You're in — ${destName} alert armed ✈`
        : `✈ You're in — welcome to Mr Cheap Flights`,
      html: buildWelcomeHtml(siteUrl, unsubUrl, destName, `${siteUrl}/r/${memberToken}`),
      text: `Welcome to Mr Cheap Flights! Fresh verified deals land most mornings${destName ? `, and your ${destName} price alert is armed` : ''}. See today's deals: ${siteUrl}  Unsubscribe: ${unsubUrl}`,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    if (res.ok) {
      await env.DB.prepare(
        'UPDATE subscribers SET welcomed_at=unixepoch() WHERE id=?'
      ).bind(subscriberId).run();
    }
  } catch { /* welcome must never break a signup */ }
}
