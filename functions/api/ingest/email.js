// POST /api/ingest/email — turn a forwarded newsletter into deal candidates.
//
// Auth: Bearer <INGEST_SECRET> (falls back to CRON_SECRET so it works without
// a new secret). The transport is deliberately thin: a Cloudflare Email Worker
// (see workers/email-ingest/) forwards the message here, so all the parsing
// lives in the app where it's testable, and swapping transport later changes
// nothing.
//
// Body: { from, subject, html, text, region? }
//
// SAFETY: the sender must be on the email_sources allowlist, so a spoofed
// message can't inject deals. Parsing reuses the RSS rules — resolve-or-reject,
// non-flight guard, currency-per-region — so nothing is invented here either.

import { logOp } from '../../_lib/oplog.js';
import { parseNewsletter } from '../../_lib/email-deals.js';

function senderKey(from) {
  const m = String(from || '').toLowerCase().match(/[\w.+-]+@([\w.-]+)/);
  return { address: (String(from || '').toLowerCase().match(/[\w.+-]+@[\w.-]+/) || [''])[0], domain: m ? m[1] : '' };
}

export async function onRequestPost(context) {
  const auth = context.request.headers.get('Authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const secret = context.env.INGEST_SECRET || context.env.CRON_SECRET;
  if (!secret || provided !== secret) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const { address, domain } = senderKey(body.from);
  if (!domain) return Response.json({ error: 'from address required' }, { status: 400 });

  // Allowlist: match the full address first, then the domain.
  let source = null;
  try {
    source = await context.env.DB.prepare(
      'SELECT * FROM email_sources WHERE active=1 AND (sender=? OR sender=?) LIMIT 1'
    ).bind(address, domain).first();
  } catch {
    return Response.json({ error: 'email_sources not migrated' }, { status: 503 });
  }
  if (!source) {
    await logOp(context.env, 'email-ingest', false, { rejected_sender: domain });
    return Response.json({ ok: false, error: `sender not allowlisted: ${domain}` }, { status: 403 });
  }

  // Region: explicit → source default → parse for both and keep what resolves.
  const explicit = ['ie', 'uk'].includes(body.region) ? body.region : null;
  const regions = explicit ? [explicit] : (source.region ? [source.region] : ['ie', 'uk']);

  const found = [];
  for (const region of regions) {
    const deals = parseNewsletter({ html: body.html, text: body.text, subject: body.subject, region });
    for (const d of deals) found.push({ ...d, region });
  }

  let inserted = 0, duplicates = 0;
  for (const d of found) {
    try {
      const existing = await context.env.DB.prepare(
        'SELECT id FROM scraped_deals WHERE source_name=? AND route=? AND price=?'
      ).bind(source.name, d.route, d.price).first();
      if (existing) { duplicates++; continue; }

      await context.env.DB.prepare(
        `INSERT INTO scraped_deals (source_name, source_url, flag, route, dates, price, badge, region, raw_snippet, origins_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(source.name, d.url || `https://${domain}`, d.flag, d.route, d.dates || '',
             d.price, d.badge || '🔥 Hot', d.region, d.snippet || null,
             d.origins && d.origins.length ? JSON.stringify(d.origins) : null).run();
      inserted++;
    } catch { /* one bad row must not lose the rest of the email */ }
  }

  try {
    await context.env.DB.prepare(
      'UPDATE email_sources SET last_seen=unixepoch(), deals_found=deals_found+? WHERE id=?'
    ).bind(inserted, source.id).run();
  } catch { /* non-fatal */ }

  const summary = { source: source.name, parsed: found.length, inserted, duplicates,
    multi_origin: found.filter((d) => d.origins && d.origins.length).length };
  await logOp(context.env, 'email-ingest', true, summary);
  return Response.json({ ok: true, ...summary });
}
