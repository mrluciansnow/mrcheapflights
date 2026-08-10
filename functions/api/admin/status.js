// GET /api/admin/status — one place that answers "what is actually switched on?"
//
// Configuration had spread across ~15 environment secrets, several D1 settings
// rows and a handful of feature flags, with no single view. Working out whether
// the newsletter was armed, whether ads were in sandbox, or whether conversions
// were enabled meant reading source or guessing. Several real incidents in this
// project came down to "nobody knew X was off": the fare token was wrong for
// days, the enrich cron was dying every morning, the health monitor sat
// disabled.
//
// SECRET SAFETY: this reports PRESENCE and SHAPE only — never a value. A
// booleanised secret can't leak the secret.

import { requireAdmin } from '../../_lib/auth.js';

const has = (v) => !!(v && String(v).trim());
const shape = (v) => {
  const t = String(v || '').trim();
  if (!t) return null;
  return { len: t.length, sandbox: /^sandbox/i.test(t) };
};

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const env = context.env;
  const out = { generated_at: Math.floor(Date.now() / 1000), integrations: {}, flags: {}, data: {}, automation: {} };

  out.integrations = {
    anthropic:      { armed: has(env.ANTHROPIC_API_KEY),   purpose: 'deal scoring, captions, ad copy' },
    resend_email:   { armed: has(env.RESEND_API_KEY),      purpose: 'newsletter, alerts, digests' },
    travelpayouts:  { armed: has(env.TRAVELPAYOUTS_TOKEN), purpose: 'fare verification + multi-city fan-out' },
    serpapi:        { armed: has(env.SERPAPI_KEY),         purpose: 'Google Flights verification (~100/mo free)' },
    buffer:         { armed: has(env.BUFFER_ACCESS_TOKEN), purpose: 'Instagram/Facebook publishing' },
    stripe:         { armed: has(env.STRIPE_SECRET_KEY),   purpose: 'premium checkout' },
    meta_ads:       { armed: has(env.META_ACCESS_TOKEN),   ...(shape(env.META_ACCESS_TOKEN) || {}) },
    tiktok_ads:     { armed: has(env.TIKTOK_ACCESS_TOKEN), ...(shape(env.TIKTOK_ACCESS_TOKEN) || {}) },
    email_ingest:   { armed: has(env.INGEST_SECRET || env.CRON_SECRET), purpose: 'newsletter ingestion' },
    cron:           { armed: has(env.CRON_SECRET),         purpose: 'authenticates every scheduled job' },
  };

  out.flags = {
    NEWSLETTER_ENABLED:  env.NEWSLETTER_ENABLED === '1',
    AUTO_PUBLISH:        env.AUTO_PUBLISH === '1',
    ADS_LIVE:            env.ADS_LIVE === '1',
    ADS_ALLOW_SCALE:     env.ADS_ALLOW_SCALE === '1',
    CONVERSIONS_ENABLED: env.CONVERSIONS_ENABLED === '1',
    ADS_MAX_DAILY_BUDGET: env.ADS_MAX_DAILY_BUDGET || '20 (default)',
  };

  // Inventory + queue health, so "is the shop stocked?" is answerable here too.
  try {
    const d = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status='live' AND (expiry IS NULL OR date(expiry) >= date('now')) AND region='ie' THEN 1 ELSE 0 END) AS live_ie,
         SUM(CASE WHEN status='live' AND (expiry IS NULL OR date(expiry) >= date('now')) AND region='uk' THEN 1 ELSE 0 END) AS live_uk,
         SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS drafts
       FROM deals`
    ).first();
    const q = await env.DB.prepare(
      `SELECT COUNT(*) AS pending,
              SUM(CASE WHEN confidence IS NULL THEN 1 ELSE 0 END) AS unscored,
              SUM(CASE WHEN confidence >= 80 THEN 1 ELSE 0 END) AS ready,
              SUM(CASE WHEN confidence >= 40 AND confidence < 80 THEN 1 ELSE 0 END) AS needs_review
       FROM scraped_deals WHERE status='pending'`
    ).first();
    const img = await env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(bytes)),0)/1048576 AS mb FROM images`
    ).first();
    out.data = { ...d, ...q, images: img?.n ?? 0, images_mb: img?.mb ?? 0 };
  } catch { /* pre-migration */ }

  // Last outcome per automation, including runs the scheduler killed.
  try {
    const { results } = await env.DB.prepare(
      `SELECT kind, ok, detail, created_at FROM op_log
       WHERE id IN (SELECT MAX(id) FROM op_log GROUP BY kind)
       ORDER BY kind`
    ).all();
    for (const r of results || []) {
      let killed = false;
      try { killed = JSON.parse(r.detail || '{}').status === 'running'; } catch { /* ignore */ }
      out.automation[r.kind] = {
        ok: !!r.ok,
        killed_mid_run: killed,
        last_run: r.created_at,
        age_hours: Math.round((Date.now() / 1000 - r.created_at) / 360) / 10,
      };
    }
  } catch { /* op_log absent */ }

  // Plain-language problems, so the answer isn't buried in the numbers.
  out.warnings = [];
  if (out.data.live_ie === 0) out.warnings.push('mrcheapflights.ie has NO live deals');
  if (out.data.live_uk === 0) out.warnings.push('mrcheapflights.co.uk has NO live deals');
  if (out.data.needs_review > 0) out.warnings.push(`${out.data.needs_review} candidate(s) in the 40-79 review band`);
  if (out.data.images_mb > 50) out.warnings.push(`images use ${out.data.images_mb}MB of D1 — move to R2`);
  if (!out.flags.NEWSLETTER_ENABLED) out.warnings.push('newsletter is in shell mode (NEWSLETTER_ENABLED not set)');
  for (const [k, v] of Object.entries(out.automation)) {
    if (v.killed_mid_run) out.warnings.push(`${k}: last run was killed mid-flight (timeout?)`);
    else if (!v.ok) out.warnings.push(`${k}: last run failed`);
  }

  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
