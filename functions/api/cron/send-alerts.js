// POST/GET /api/cron/send-alerts — destination price-alert dispatcher.
// Finds newly-live deals that map to a destination hub, matches them against
// active watchlists (region + destination + optional price cap + 12h
// per-watcher throttle) and sends targeted alert emails. Marks each deal
// alerted so it fires at most once.
//
// Bearer CRON_SECRET or admin. Double-gated like the digest: needs
// RESEND_API_KEY + NEWSLETTER_ENABLED=1 (alerts are opt-in, but we still
// never send until the site is explicitly armed for email).
// Suggested schedule: hourly, or right after enrich (deals go live at ~09:00).

import { requireAdmin } from '../../_lib/auth.js';
import { sendEmail } from '../../_lib/email.js';
import { alertSubject, buildAlertHtml } from '../../_lib/publishers.js';
import { destSlugForText, getDestination } from '../../_lib/destinations.js';
import { logOp } from '../../_lib/oplog.js';

const MAX_SENDS_PER_RUN = 80;      // headroom under Resend free tier alongside digest
const THROTTLE_SECONDS = 12 * 3600; // one alert per watcher per 12h

// Core dispatcher — exported so the daily newsletter cron can run it inline
// (no separate scheduled job required). Logs its own op entry.
export async function dispatchAlerts(env) {
  const armed = env.NEWSLETTER_ENABLED === '1';
  const marker = env.TRAVELPAYOUTS_MARKER || '';
  const summary = { armed, deals_scanned: 0, matched: 0, sent: 0, skipped_throttle: 0 };

  const { results: deals } = await env.DB.prepare(
    `SELECT id, flag, route, dates, price, badge, slug, region, was_price, airline, image_url
     FROM deals
     WHERE status='live' AND alerted=0
       AND created_at >= unixepoch() - 93600
       AND (expiry IS NULL OR date(expiry) >= date('now'))
     ORDER BY created_at DESC LIMIT 40`
  ).all();

  summary.deals_scanned = (deals || []).length;
  if (!deals || !deals.length) {
    await logOp(env, 'alerts', true, { ...summary, reason: 'no new deals' });
    return { ...summary, reason: 'no new deals' };
  }

  let budget = MAX_SENDS_PER_RUN;
  const now = Math.floor(Date.now() / 1000);
  const alertedDealIds = [];

  for (const deal of deals) {
    const destSlug = destSlugForText(deal.route);
    if (!destSlug) { alertedDealIds.push(deal.id); continue; }

    const priceNum = parseFloat(String(deal.price).replace(/[^0-9.]/g, ''));
    const siteUrl = deal.region === 'uk' ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';

    const { results: watches } = await env.DB.prepare(
      `SELECT id, email, member_token, max_price, last_alerted_at
       FROM watchlists WHERE active=1 AND region=? AND dest_slug=?`
    ).bind(deal.region, destSlug).all();

    const destName = getDestination(destSlug)?.name || destSlug.replace(/-/g, ' ');

    for (const w of (watches || [])) {
      if (budget <= 0) break;
      if (w.max_price && !isNaN(priceNum) && priceNum > w.max_price) continue;
      if (w.last_alerted_at && (now - w.last_alerted_at) < THROTTLE_SECONDS) { summary.skipped_throttle++; continue; }
      summary.matched++;
      if (!armed) continue;

      const unsub = `${siteUrl}/api/unsubscribe?token=${encodeURIComponent(w.member_token)}&dest=${encodeURIComponent(destSlug)}`;
      const res = await sendEmail(env, {
        to: w.email,
        subject: alertSubject(deal, destName),
        html: buildAlertHtml(deal, destName, siteUrl, marker, unsub),
        headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      if (res.ok) {
        summary.sent++; budget--;
        await env.DB.prepare('UPDATE watchlists SET last_alerted_at=? WHERE id=?').bind(now, w.id).run();
      }
    }
    alertedDealIds.push(deal.id);
  }

  if (armed && alertedDealIds.length) {
    await env.DB.batch(alertedDealIds.map((id) => env.DB.prepare('UPDATE deals SET alerted=1 WHERE id=?').bind(id)));
  }

  await logOp(env, 'alerts', true, summary);
  return summary;
}

async function handle(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!context.env.CRON_SECRET || provided !== context.env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }
  const result = await dispatchAlerts(context.env);
  return Response.json({ ok: true, ...result });
}

export async function onRequestPost(context) { return handle(context); }
export async function onRequestGet(context) { return handle(context); }
