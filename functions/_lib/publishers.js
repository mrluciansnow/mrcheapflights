// Channel publishers — port of the Phase 4 pack's publishEmail.ts + publishSocial.ts,
// adapted for Cloudflare Workers and this site's data model.
//
// publishWebsite from the pack maps to D1 here: a deal is "published to the
// website" when its `deals` row has status='live' (the site + RSS feed render
// straight from that table, already region-localised — one row per region).
//
// Channel independence rule (from the pack): one failing channel never blocks
// the others, and per-channel state columns make every publish retryable.

import { routeSearchUrl } from './affiliate.js';

// ── EMAIL (Resend — the live path) ───────────────────────────────────────────
// The pack ships Mailchimp campaign sending; this site already has a working
// Resend integration (_lib/email.js), so Resend is the primary implementation.
//
// ── EMAIL SHELL ───────────────────────────────────────────────────
// Resend:    RESEND_API_KEY (already wired via _lib/email.js — no-ops without)
// Mailchimp alternative (unported, from the pack): MAILCHIMP_API_KEY,
//   MAILCHIMP_SERVER_PREFIX, MAILCHIMP_LIST_ID — register at mailchimp.com.
//   If the list outgrows Resend's free tier (100 emails/day), swap the send
//   loop in api/cron/send-newsletter.js for Mailchimp campaign calls.
// ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One deal's HTML block for the digest/blast emails.
 *  Text-first (no image pipeline yet), matching the site's dark/gold brand. */
export function dealEmailBlock(deal, siteUrl, marker) {
  const dealUrl = deal.slug ? `${siteUrl}/#deal/${encodeURIComponent(deal.slug)}` : siteUrl;
  const searchUrl = routeSearchUrl(deal.route, deal.region, marker);
  const wasLine = deal.was_price ? ` · was ${esc(deal.was_price)}` : '';
  const airlineLine = deal.airline ? `${esc(deal.airline)} · ` : '';

  const imgSrc = deal.image_url
    ? (String(deal.image_url).startsWith('/') ? siteUrl + deal.image_url : deal.image_url)
    : null;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:#0A0F2E;border-radius:12px;">
    ${imgSrc ? `<tr><td style="padding:0;"><img src="${esc(imgSrc)}" width="100%" style="border-radius:12px 12px 0 0;display:block;" alt="${esc(deal.route)}"/></td></tr>` : ''}
    <tr><td style="padding:20px;">
      <div style="font-family:Arial,sans-serif;font-size:12px;color:#FF2D78;font-weight:bold;letter-spacing:1px;margin-bottom:6px;">
        ${esc(deal.badge || '🔥 Hot')}
      </div>
      <div style="font-family:Impact,Arial,sans-serif;font-size:24px;color:#FFD700;">
        ${esc(deal.flag || '✈️')} ${esc(deal.route)} — ${esc(deal.price)} RETURN
      </div>
      <div style="font-family:Arial,sans-serif;font-size:13px;color:#ffffff;opacity:0.7;margin:6px 0 14px;">
        ${airlineLine}${esc(deal.dates || 'Dates flexible')}${wasLine}
      </div>
      <a href="${esc(dealUrl)}" style="display:inline-block;background:#FFD700;color:#0A0F2E;font-family:Arial,sans-serif;font-weight:bold;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        VIEW THIS DEAL ✈
      </a>
      ${searchUrl ? `<a href="${esc(searchUrl)}" style="display:inline-block;margin-left:10px;color:#FFD700;font-family:Arial,sans-serif;font-size:13px;text-decoration:underline;">Check live fares →</a>` : ''}
    </td></tr>
  </table>`;
}

/** Full digest email. Returns HTML with a %%UNSUB_URL%% placeholder the send
 *  loop replaces per-recipient (each subscriber has their own token). */
export function buildDigestHtml(deals, siteUrl, marker) {
  const blocks = deals.map((d) => dealEmailBlock(d, siteUrl, marker)).join('\n');
  return `<div style="background:#060B1F;padding:24px;">
    <div style="text-align:center;padding-bottom:18px;">
      <span style="font-family:Impact,Arial,sans-serif;font-size:26px;color:#FFD700;letter-spacing:1px;">MR CHEAP FLIGHTS ✈</span>
      <div style="font-family:Arial,sans-serif;font-size:11px;color:#00E5CC;letter-spacing:3px;margin-top:2px;">TODAY'S DEALS</div>
    </div>
    ${blocks}
    <div style="text-align:center;font-family:Georgia,serif;font-style:italic;color:#FFD700;font-size:13px;padding:16px;">
      Cheap never looked this good.
    </div>
    <div style="text-align:center;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.35);padding-bottom:8px;">
      You're getting this because you signed up at ${esc(siteUrl.replace('https://', ''))}.
      <a href="%%UNSUB_URL%%" style="color:rgba(255,255,255,0.5);">Unsubscribe</a>
    </div>
  </div>`;
}

/** Digest subject line, matching the pack's format. */
export function digestSubject(deals) {
  const top = deals[0];
  const dest = (String(top.route).split(/→|->/)[1] || top.route).trim();
  const more = deals.length - 1;
  return `✈ Today's deals: ${dest} from ${top.price}${more > 0 ? ` + ${more} more` : ''}`;
}

/** Urgent error-fare blast subject. */
export function urgentSubject(deal) {
  const dest = (String(deal.route).split(/→|->/)[1] || deal.route).trim();
  return `🚨 ERROR FARE: ${dest} ${deal.price} return — GO NOW`;
}

// ── SOCIAL ────────────────────────────────────────────────────────────────────
// ── SOCIAL SHELL ──────────────────────────────────────────────────
// Option A (recommended): Buffer — https://buffer.com/developers
//   Env var: BUFFER_ACCESS_TOKEN
//   One token posts to every connected profile (IG, FB, TikTok, X).
// Option B: Meta direct — https://developers.facebook.com
//   Env vars: META_PAGE_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID
//   More setup (app review for IG publishing) but no middleman.
// Without any keys: no-ops with {shellMode:true}.
// Set via: wrangler pages secret put <NAME> --project-name mrcheap
// ──────────────────────────────────────────────────────────────────

async function publishViaBuffer(copy, imageUrl, token) {
  const result = { instagram: false, facebook: false, shellMode: false };
  const profilesRes = await fetch(
    `https://api.bufferapp.com/1/profiles.json?access_token=${encodeURIComponent(token)}`
  );
  if (!profilesRes.ok) return result;
  const profiles = await profilesRes.json();
  if (!Array.isArray(profiles)) return result;

  for (const profile of profiles) {
    const isIG = profile.service === 'instagram';
    const isFB = profile.service === 'facebook';
    if (!isIG && !isFB) continue;

    const params = new URLSearchParams({
      access_token: token,
      'profile_ids[]': profile.id,
      text: copy,
      now: 'true',
    });
    if (imageUrl) params.set('media[photo]', imageUrl);

    const res = await fetch('https://api.bufferapp.com/1/updates/create.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (res.ok && isIG) result.instagram = true;
    if (res.ok && isFB) result.facebook = true;
  }
  return result;
}

async function publishViaMeta(copy, imageUrl, env) {
  const result = { instagram: false, facebook: false, shellMode: false };
  // Meta photo endpoints require a hosted image; without one we can only
  // post text to the FB page feed.
  if (env.META_PAGE_ID) {
    const endpoint = imageUrl
      ? `https://graph.facebook.com/v19.0/${env.META_PAGE_ID}/photos`
      : `https://graph.facebook.com/v19.0/${env.META_PAGE_ID}/feed`;
    const body = imageUrl
      ? { url: imageUrl, caption: copy, access_token: env.META_PAGE_ACCESS_TOKEN }
      : { message: copy, access_token: env.META_PAGE_ACCESS_TOKEN };
    const fbRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    result.facebook = fbRes.ok;
  }
  // Instagram requires an image: two-step container → publish
  if (env.META_IG_USER_ID && imageUrl) {
    const containerRes = await fetch(
      `https://graph.facebook.com/v19.0/${env.META_IG_USER_ID}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, caption: copy, access_token: env.META_PAGE_ACCESS_TOKEN }),
      }
    );
    if (containerRes.ok) {
      const container = await containerRes.json();
      const publishRes = await fetch(
        `https://graph.facebook.com/v19.0/${env.META_IG_USER_ID}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: container.id, access_token: env.META_PAGE_ACCESS_TOKEN }),
        }
      );
      result.instagram = publishRes.ok;
    }
  }
  return result;
}

export async function publishSocial(copy, imageUrl, env) {
  if (env.BUFFER_ACCESS_TOKEN) return publishViaBuffer(copy, imageUrl, env.BUFFER_ACCESS_TOKEN);
  if (env.META_PAGE_ACCESS_TOKEN) return publishViaMeta(copy, imageUrl, env);
  return { instagram: false, facebook: false, shellMode: true }; // SHELL: no keys yet
}
