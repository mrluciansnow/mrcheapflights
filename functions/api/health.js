// GET /api/health — public liveness + readiness probe.
//
// Monitored by cron-job.org every 10 minutes with email-on-failure enabled,
// so a dead DB or broken Functions runtime pages the admin without any paid
// monitoring service. Returns 503 (not 200) whenever a core dependency fails
// so plain HTTP-status monitors catch it.
//
// Deliberately terse: no secrets, no internal error text, no op detail —
// this endpoint is world-readable. The morning briefing carries the detail.

export async function onRequestGet(context) {
  const out = { ok: true, db: false, deals_live: null, ts: Math.floor(Date.now() / 1000) };

  // SERVABLE deals only — status='live' AND not past expiry, counted per region.
  // The old query counted status='live' alone, so 8 deals that expired in July
  // still read as inventory and the probe reported a healthy 14 while
  // mrcheapflights.ie was actually serving ZERO deals. An empty shop must not
  // look healthy: a region with nothing to show now fails the probe, which the
  // existing 10-minute monitor turns into an email.
  try {
    const row = await context.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN region='ie' THEN 1 ELSE 0 END) AS ie,
         SUM(CASE WHEN region='uk' THEN 1 ELSE 0 END) AS uk
       FROM deals
       WHERE status='live' AND (expiry IS NULL OR date(expiry) >= date('now'))`
    ).first();
    out.db = true;
    const ie = row?.ie ?? 0, uk = row?.uk ?? 0;
    out.deals_live = ie + uk;
    out.deals_by_region = { ie, uk };
    if (ie === 0 || uk === 0) {
      out.ok = false;
      out.empty_regions = [ie === 0 ? 'ie' : null, uk === 0 ? 'uk' : null].filter(Boolean);
    }
  } catch {
    out.ok = false;
  }

  // Staleness canary: if the newest op_log row is >26h old, every cron has
  // been silent for a full day — the scheduler or auth is broken.
  try {
    const op = await context.env.DB.prepare(
      `SELECT MAX(created_at) AS latest FROM op_log`
    ).first();
    if (op?.latest && (out.ts - op.latest) > 26 * 3600) {
      out.ok = false;
      out.crons_stale = true;
    }
  } catch { /* op_log absent — ignore, db check already covers the core */ }

  return Response.json(out, {
    status: out.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
