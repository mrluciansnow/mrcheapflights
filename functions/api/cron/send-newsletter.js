// POST/GET /api/cron/send-newsletter — daily subscriber digest (port of the
// pack's app/api/cron/send-newsletter/route.ts, adapted to D1 + Resend).
//
// Gathers live deals from the last 48h that haven't gone out by email yet and
// sends one branded digest per region to that region's subscribers.
// cron-job.org schedule: 09:30 Europe/London, Bearer CRON_SECRET.
//
// ── NEWSLETTER SHELL ──────────────────────────────────────────────
// Two env vars gate real sending — without them this endpoint reports what it
// WOULD send and exits without emailing anyone:
//   RESEND_API_KEY       — Resend account key (see _lib/email.js)
//   NEWSLETTER_ENABLED=1 — explicit arming flag, so a configured Resend key
//                          can't accidentally start a daily mass-send.
//     wrangler pages secret put NEWSLETTER_ENABLED --project-name mrcheap
// ──────────────────────────────────────────────────────────────────
//
// Idempotency (two layers, safe to re-run):
//   1. settings key newsletter_last_sent_<region> = today → region skipped
//   2. per-deal published_email flag → a deal is only ever digested once

import { requireAdmin } from '../../_lib/auth.js';
import { sendEmail } from '../../_lib/email.js';
import { buildDigestHtml, digestSubject } from '../../_lib/publishers.js';
import { logOp } from '../../_lib/oplog.js';
import { dispatchAlerts } from './send-alerts.js';

const MAX_SENDS_PER_RUN = 90; // Resend free tier: 100 emails/day
const MAX_DEALS_PER_DIGEST = 8;

// Preference filtering — AND across categories, OR within a category.
// Unparseable/absent data always passes (never hide a deal on bad data).
const AIRPORT_CITY = { DUB: 'dublin', ORK: 'cork', SNN: 'shannon', NOC: 'knock', KIR: 'kerry', BFS: 'belfast' };
const INTEREST_TYPES = {
  'beach': ['sun', 'wintersun'], 'city': ['city'], 'longhaul': ['longhaul'],
  'winter sun': ['wintersun'], 'usa': ['longhaul'], 'europe': ['city', 'sun'],
};

function filterDealsForSubscriber(deals, prefsJson) {
  if (!prefsJson) return deals;
  let prefs;
  try { prefs = JSON.parse(prefsJson); } catch { return deals; }
  if (!prefs || typeof prefs !== 'object') return deals;

  return deals.filter((d) => {
    if (prefs.budget) {
      const n = parseFloat(String(d.price).replace(/[^0-9.]/g, ''));
      if (!isNaN(n) && n > prefs.budget) return false;
    }
    if (Array.isArray(prefs.airports) && prefs.airports.length) {
      const origin = String(d.route).split(/→|->/)[0].toLowerCase();
      const match = prefs.airports.some((code) => origin.includes(AIRPORT_CITY[code] || '~'));
      if (!match) return false;
    }
    if (Array.isArray(prefs.interests) && prefs.interests.length && d.dest_type) {
      const wanted = new Set(prefs.interests.flatMap((i) => INTEREST_TYPES[i] || []));
      // Interests that don't map to a dest_type (cheap, ski) impose no filter
      if (wanted.size && !wanted.has(d.dest_type)) return false;
    }
    return true;
  });
}

async function handle(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = context.env.CRON_SECRET;
    if (!secret || !provided || provided !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const marker = context.env.TRAVELPAYOUTS_MARKER || '';
  const armed = context.env.NEWSLETTER_ENABLED === '1';
  const summary = {};
  let sendBudget = MAX_SENDS_PER_RUN;

  for (const region of ['ie', 'uk']) {
    const siteUrl = region === 'uk' ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
    const regionSummary = { deals: 0, subscribers: 0, sent: 0, skipped: null };
    summary[region] = regionSummary;

    // Layer 1: already sent today?
    const lastSent = await context.env.DB.prepare(
      'SELECT value FROM settings WHERE key=?'
    ).bind(`newsletter_last_sent_${region}`).first();
    const today = new Date().toISOString().slice(0, 10);
    if (lastSent?.value === today) {
      regionSummary.skipped = 'already sent today';
      continue;
    }

    // Layer 2: fresh live deals not yet emailed
    const { results: deals } = await context.env.DB.prepare(
      `SELECT id, flag, route, dates, price, badge, url, slug, region, was_price, airline, dest_type, image_url
       FROM deals
       WHERE region=? AND status='live' AND published_email=0
         AND created_at >= unixepoch() - 172800
         AND (expiry IS NULL OR date(expiry) >= date('now'))
       ORDER BY created_at DESC LIMIT ?`
    ).bind(region, MAX_DEALS_PER_DIGEST).all();

    regionSummary.deals = (deals || []).length;
    if (!deals || deals.length === 0) {
      regionSummary.skipped = 'nothing to send';
      continue;
    }

    const { results: subs } = await context.env.DB.prepare(
      `SELECT email, member_token, prefs FROM subscribers
       WHERE region=? AND newsletter_opt_out=0`
    ).bind(region).all();

    regionSummary.subscribers = (subs || []).length;
    if (!subs || subs.length === 0) {
      regionSummary.skipped = 'no subscribers';
      continue;
    }

    if (!armed) {
      // SHELL mode: report what would happen, touch nothing
      regionSummary.skipped = 'shellMode — NEWSLETTER_ENABLED not set';
      continue;
    }

    let sent = 0;
    let skippedNoMatch = 0;
    for (const sub of subs) {
      if (sendBudget <= 0) break;
      // Personalisation: filter this region's deals by the member's saved
      // preferences. No prefs (or nothing matching a category) → full digest;
      // prefs that match zero deals → no email today rather than noise.
      const myDeals = filterDealsForSubscriber(deals, sub.prefs);
      if (!myDeals.length) { skippedNoMatch++; continue; }

      const unsubUrl = `${siteUrl}/api/unsubscribe?token=${encodeURIComponent(sub.member_token)}`;
      const res = await sendEmail(context.env, {
        to: sub.email,
        subject: digestSubject(myDeals),
        html: buildDigestHtml(myDeals, siteUrl, marker).replaceAll('%%UNSUB_URL%%', unsubUrl),
        // RFC 8058 one-click unsubscribe — Gmail/Yahoo surface a native
        // Unsubscribe button and it materially helps deliverability.
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      if (res.ok) { sent++; sendBudget--; }
    }
    if (skippedNoMatch) regionSummary.skipped_no_pref_match = skippedNoMatch;
    regionSummary.sent = sent;
    if (sendBudget <= 0 && sent < subs.length) {
      regionSummary.truncated = `daily send budget (${MAX_SENDS_PER_RUN}) reached`;
    }

    // Mark deals + date only after at least one successful send
    if (sent > 0) {
      const stmts = deals.map((d) => context.env.DB.prepare(
        'UPDATE deals SET published_email=1, updated_at=unixepoch() WHERE id=?'
      ).bind(d.id));
      stmts.push(context.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=unixepoch()`
      ).bind(`newsletter_last_sent_${region}`, today));
      await context.env.DB.batch(stmts);
    }
  }

  await logOp(context.env, 'newsletter', true, { armed, ...summary });

  // Fire destination price alerts in the same daily run — no separate cron
  // needed. Its own throttle + alerted-once flag keep it independent of the
  // digest's per-region dedup. Never let an alert failure fail the digest.
  let alerts = null;
  try { alerts = await dispatchAlerts(context.env); } catch (e) { alerts = { error: e.message }; }

  return Response.json({ ok: true, armed, ...summary, alerts });
}

export async function onRequestPost(context) { return handle(context); }
// GET kept for parity with the pack's Vercel cron (which fires GET)
export async function onRequestGet(context) { return handle(context); }
