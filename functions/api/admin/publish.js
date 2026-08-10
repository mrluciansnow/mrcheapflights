// POST /api/admin/publish — THE PUBLISH BUTTON (port of the pack's
// app/api/pipeline/publish/route.ts, adapted to D1 + this site's deal model).
//
// Takes approved deals and fires every channel. Idempotent: per-channel state
// on the deals row means retries never double-post. One failing channel never
// blocks the others.
//
// Request:  POST { "dealIds": [1, 2, ...] }
// Response: per-deal, per-channel results + shell-mode notes
//
// Channels:
//   website — status='live' on the deals row (site + RSS render from D1)
//   social  — Buffer/Meta via _lib/publishers.js (SHELL until keys set)
//   email   — error fares blast immediately (when NEWSLETTER_ENABLED=1);
//             everything else waits for the daily digest cron

import { requireAdmin } from '../../_lib/auth.js';
import { sendEmail } from '../../_lib/email.js';
import { logOp } from '../../_lib/oplog.js';
import { routeSearchUrl } from '../../_lib/affiliate.js';
import { publishSocial, dealEmailBlock, urgentSubject, igCaption } from '../../_lib/publishers.js';
import { generateDealImage } from '../../_lib/imagegen.js';

const MAX_BATCH = 20;
const MAX_BLAST_RECIPIENTS = 90; // Resend free tier: 100 emails/day
const MAX_INLINE_IMAGES = 4;     // ~2-5s each — bounds publish latency

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) {
    // Cron fallback, same pattern as trigger-scrape — allows future auto-publish
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = context.env.CRON_SECRET;
    if (!secret || !provided || provided !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body;
  try { body = await context.request.json(); } catch { body = null; }
  const dealIds = body?.dealIds;
  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    return Response.json({ error: 'dealIds array required' }, { status: 400 });
  }
  if (dealIds.length > MAX_BATCH) {
    return Response.json({ error: `max ${MAX_BATCH} deals per publish` }, { status: 400 });
  }

  // Optional channel filter: {"channels": ["social"]} fires just that channel
  // (used by the pipeline's "Post socials now" test button). Default = all.
  const ALL_CHANNELS = ['website', 'social', 'email'];
  const channels = Array.isArray(body?.channels) && body.channels.length
    ? ALL_CHANNELS.filter((c) => body.channels.includes(c))
    : ALL_CHANNELS;
  // draft:true → social posts land in Buffer for review instead of going live
  // (the safe "verify posting works" path).
  const draft = body?.draft === true;
  const wants = (c) => channels.includes(c);

  const marker = context.env.TRAVELPAYOUTS_MARKER || '';
  const results = {};
  let imagesGenerated = 0;

  for (const rawId of dealIds) {
    const id = parseInt(rawId);
    if (!id || id < 1) { results[String(rawId)] = { error: 'invalid id' }; continue; }

    const deal = await context.env.DB.prepare(
      `SELECT id, flag, route, dates, price, badge, url, expiry, slug, region, status,
              pipeline_copy, was_price, airline, published_email, published_social, image_url, poster_url
       FROM deals WHERE id=?`
    ).bind(id).first();

    if (!deal) { results[id] = { error: 'Deal not found' }; continue; }

    const dealResult = {};
    const siteUrl = deal.region === 'uk' ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';

    // ── IMAGE: publish never ships an imageless deal if we can help it ──
    // (needed for site tiles AND social — Instagram posts require media)
    if ((wants('website') || wants('social')) && !deal.image_url && context.env.AI && imagesGenerated < MAX_INLINE_IMAGES) {
      try {
        const img = await generateDealImage(context.env, deal);
        await context.env.DB.prepare(
          'UPDATE deals SET image_url=?, updated_at=unixepoch() WHERE id=?'
        ).bind(img.url, id).run();
        deal.image_url = img.url;
        imagesGenerated++;
        dealResult.image = { generated: true, url: img.url };
      } catch (e) {
        // Never block a publish on image generation — backfill cron retries daily
        dealResult.image = { generated: false, error: e.message };
      }
    }

    // ── WEBSITE (skip if already live — idempotency) ──
    try {
      if (!wants('website')) {
        dealResult.website = { skipped: 'channel not requested' };
      } else if (deal.status !== 'live') {
        await context.env.DB.prepare(
          `UPDATE deals SET status='live', updated_at=unixepoch() WHERE id=?`
        ).bind(id).run();
        dealResult.website = { published: true };
      } else {
        dealResult.website = { skipped: 'already live' };
      }
    } catch (e) {
      dealResult.website = { error: e.message };
    }

    // ── SOCIAL ──
    try {
      if (!wants('social')) {
        dealResult.social = { skipped: 'channel not requested' };
      } else if (!deal.published_social) {
        const searchUrl = routeSearchUrl(deal.route, deal.region, marker);
        const dealPageUrl = deal.slug ? `${siteUrl}/deals/${encodeURIComponent(deal.slug)}` : siteUrl;
        // Chosen pipeline copy wins; otherwise the IG-structured template —
        // never the bare one-liner that used to go out for express publishes.
        const copy = (deal.pipeline_copy || igCaption(deal))
          + `\n\n${dealPageUrl}` + (searchUrl ? `\n${searchUrl}` : '');
        // Branded ad poster (mascot + price + flag composite) beats the raw
        // destination photo for social; falls back when no poster exists yet.
        const rawImg = deal.poster_url || deal.image_url;
        const socialImg = rawImg
          ? (String(rawImg).startsWith('/') ? siteUrl + rawImg : rawImg)
          : '';
        const social = await publishSocial(copy, socialImg, context.env, { draft });
        dealResult.social = social;
        // A draft isn't a real publish — never mark the deal as posted for it.
        if (!social.shellMode && !social.draft && (social.instagram || social.facebook)) {
          await context.env.DB.prepare(
            'UPDATE deals SET published_social=1, updated_at=unixepoch() WHERE id=?'
          ).bind(id).run();
        }
      } else {
        dealResult.social = { skipped: 'already published' };
      }
    } catch (e) {
      dealResult.social = { error: e.message };
    }

    // ── EMAIL: urgent error fares blast immediately; the rest wait
    //    for the daily digest cron (send-newsletter) ──
    try {
      const isErrorFare = String(deal.badge || '').includes('Mistake');
      if (!wants('email')) {
        dealResult.email = { skipped: 'channel not requested' };
      } else if (isErrorFare && !deal.published_email) {
        if (context.env.NEWSLETTER_ENABLED !== '1') {
          dealResult.email = { shellMode: true, reason: 'NEWSLETTER_ENABLED not set' };
        } else {
          // Instant error-fare blasts are a premium perk — free subscribers
          // see the deal on the site and in the next morning's digest.
          const { results: subs } = await context.env.DB.prepare(
            `SELECT email, member_token FROM subscribers
             WHERE region=? AND newsletter_opt_out=0 AND tier='premium' LIMIT ?`
          ).bind(deal.region, MAX_BLAST_RECIPIENTS).all();

          let sent = 0;
          const blockHtml = dealEmailBlock(deal, siteUrl, marker);
          for (const sub of subs || []) {
            const unsub = `${siteUrl}/api/unsubscribe?token=${encodeURIComponent(sub.member_token)}`;
            const html = `<div style="background:#060B1F;padding:24px;">${blockHtml}` +
              `<div style="text-align:center;font-family:Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.35);padding:8px;">` +
              `<a href="${unsub}" style="color:rgba(255,255,255,0.5);">Unsubscribe</a></div></div>`;
            const res = await sendEmail(context.env, {
              to: sub.email,
              subject: urgentSubject(deal),
              html,
              headers: {
                'List-Unsubscribe': `<${unsub}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            });
            if (res.ok) sent++;
          }
          dealResult.email = { blast: true, premium_only: true, sent, recipients: (subs || []).length };
          if (sent > 0) {
            await context.env.DB.prepare(
              'UPDATE deals SET published_email=1, updated_at=unixepoch() WHERE id=?'
            ).bind(id).run();
          }
        }
      } else if (deal.published_email) {
        dealResult.email = { skipped: 'already sent' };
      } else {
        dealResult.email = { queued: 'daily digest' };
      }
    } catch (e) {
      dealResult.email = { error: e.message };
    }

    results[id] = dealResult;
  }

  await logOp(context.env, 'publish', true, { deals: dealIds.length });
  return Response.json({ ok: true, results });
}
