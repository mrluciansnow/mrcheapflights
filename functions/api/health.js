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

  try {
    const row = await context.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM deals WHERE status='live'`
    ).first();
    out.db = true;
    out.deals_live = row?.n ?? 0;
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
