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
  // Server-rendered landing pages live at /deals/:slug (the old /#deal/ hash
  // predates them and just dumped people on the homepage).
  const dealUrl = deal.slug ? `${siteUrl}/deals/${encodeURIComponent(deal.slug)}` : siteUrl;
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

/** Destination price-alert subject: personal and specific. */
export function alertSubject(deal, destName) {
  return `🔔 ${destName} alert: ${deal.route} from ${deal.price} return`;
}

/** Single-deal alert email for a destination watcher. `unsubUrl` opts them
 *  out of THIS destination's alerts. */
export function buildAlertHtml(deal, destName, siteUrl, marker, unsubUrl) {
  return `<div style="background:#060B1F;padding:24px;">
    <div style="text-align:center;padding-bottom:14px;">
      <span style="font-family:Impact,Arial,sans-serif;font-size:24px;color:#FFD700;letter-spacing:1px;">🔔 ${esc(destName)} DEAL ALERT</span>
      <div style="font-family:Arial,sans-serif;font-size:12px;color:#00E5CC;letter-spacing:2px;margin-top:2px;">YOU ASKED — HERE IT IS</div>
    </div>
    ${dealEmailBlock(deal, siteUrl, marker)}
    <div style="text-align:center;font-family:Georgia,serif;font-style:italic;color:#FFD700;font-size:13px;padding:12px;">Cheap never looked this good.</div>
    <div style="text-align:center;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.35);padding-bottom:8px;">
      You're getting this because you set a ${esc(destName)} alert.
      <a href="${esc(unsubUrl)}" style="color:rgba(255,255,255,0.5);">Turn off ${esc(destName)} alerts</a>.
    </div>
  </div>`;
}

// ── SOCIAL ────────────────────────────────────────────────────────────────────

/** Instagram-ready caption for a deal — the server-side fallback when no
 *  AI-written pipeline copy was chosen. Hook line → body → CTA → hashtags,
 *  mirroring the enrich prompt's structure so hand-published and auto-published
 *  deals read the same. */
export function igCaption(deal) {
  const dest = (String(deal.route || '').split(/→|->/)[1] || deal.route || '').trim();
  const destTag = dest.replace(/[^a-zA-Z0-9]/g, '');
  const airline = deal.airline || null;
  const wasLine = deal.was_price
    ? `Normally ${deal.was_price} — right now it's ${deal.price} RETURN. Not a typo. 🤯`
    : `${deal.price} RETURN. That's less than a night out. 🤯`;

  return `🚨 ${dest.toUpperCase()} FOR ${deal.price} RETURN?! 🚨

${deal.flag || '✈️'} ${deal.route}${airline ? ` with ${airline}` : ''} — and yes, it's live right now.

${wasLine}

📅 ${deal.dates || 'Flexible dates'} · fares like this vanish in days, sometimes hours. Pack a carry-on, grab the passport, thank us from the beach.

🔗 Link in bio to grab it before it's gone ✈

#MrCheapFlights #CheapFlights #${destTag} #FlightDeals #TravelDeals #${destTag}Deals #BudgetTravel${airline ? ` #${airline.replace(/[^a-zA-Z0-9]/g, '')}` : ''}`;
}

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

// Buffer's NEW GraphQL API (2026): POST https://api.buffer.com with a Bearer
// token. The legacy api.bufferapp.com v1 this used to call rejects new-portal
// keys with 401 — that was the silent "social does nothing".
async function bufferGraphQL(token, query, variables) {
  const res = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** List the account's connected channels — also used by the pipeline's
 *  social-status check. Returns { channels: [...] } or { error }. */
export async function bufferChannels(token) {
  const org = await bufferGraphQL(token, `query { account { organizations { id } } }`);
  if (org.status !== 200 || org.body?.errors) {
    return { error: `Buffer auth failed: HTTP ${org.status} ${JSON.stringify(org.body?.errors || org.body || '').slice(0, 140)}` };
  }
  const orgId = org.body?.data?.account?.organizations?.[0]?.id;
  if (!orgId) return { error: 'Buffer token valid but no organization on the account' };

  const ch = await bufferGraphQL(token,
    `query C($input: ChannelsInput!) { channels(input: $input) { id name service } }`,
    { input: { organizationId: orgId } });
  if (ch.status !== 200 || ch.body?.errors) {
    return { error: `Buffer channels query failed: ${JSON.stringify(ch.body?.errors || '').slice(0, 140)}` };
  }
  return { channels: ch.body?.data?.channels || [] };
}

async function publishViaBuffer(copy, imageUrl, token) {
  const result = { instagram: false, facebook: false, shellMode: false, detail: [] };

  const list = await bufferChannels(token);
  if (list.error) { result.detail.push(list.error); return result; }
  if (!list.channels.length) {
    result.detail.push('Buffer works but has NO connected channels — connect Instagram/Facebook inside Buffer first.');
    return result;
  }

  for (const ch of list.channels) {
    const svc = String(ch.service || '').toLowerCase();
    const isIG = svc.includes('instagram');
    const isFB = svc.includes('facebook');
    if (!isIG && !isFB) { result.detail.push(`${ch.service}: skipped (unsupported)`); continue; }
    if (isIG && !imageUrl) { result.detail.push('instagram: skipped — IG requires an image'); continue; }

    const input = {
      channelId: ch.id,
      text: copy,
      schedulingType: 'automatic',  // publish directly, not a notification
      mode: 'shareNow',             // immediately — never sit in the queue
      assets: imageUrl ? [{ image: { url: imageUrl } }] : [],
      source: 'mrcheapflights',
    };
    const mu = await bufferGraphQL(token,
      `mutation CP($input: CreatePostInput!) {
         createPost(input: $input) { __typename ... on PostActionSuccess { post { id } } }
       }`, { input });

    const typeName = mu.body?.data?.createPost?.__typename;
    const ok = mu.status === 200 && !mu.body?.errors && typeName === 'PostActionSuccess';
    if (ok && isIG) result.instagram = true;
    if (ok && isFB) result.facebook = true;
    result.detail.push(`${svc}: ${ok ? 'posted ✓' : (JSON.stringify(mu.body?.errors || typeName || `HTTP ${mu.status}`).slice(0, 160))}`);
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
  const bufferToken = (env.BUFFER_ACCESS_TOKEN || '').trim();
  if (bufferToken) return publishViaBuffer(copy, imageUrl, bufferToken);
  if (env.META_PAGE_ACCESS_TOKEN) return publishViaMeta(copy, imageUrl, env);
  return { instagram: false, facebook: false, shellMode: true }; // SHELL: no keys yet
}
