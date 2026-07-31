// POST/GET /api/cron/fan-out — price live deals from every departure city.
// Auth: admin session OR Bearer <CRON_SECRET> (same dual pattern as the rest).
//
// Travelpayouts only, so it costs nothing; SerpApi is never touched here (a
// fan-out across ~10 origins would burn the monthly free tier in two deals).
//
// Suggested schedule: every 4h, offset from verify-fares. ?deals=N to override.

import { requireAdmin } from '../../_lib/auth.js';
import { logOp } from '../../_lib/oplog.js';
import { runFanOut } from '../../_lib/multicity.js';

async function handle(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!context.env.CRON_SECRET || provided !== context.env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const url = new URL(context.request.url);
  const n = parseInt(url.searchParams.get('deals'));
  const maxDeals = Number.isFinite(n) ? Math.min(15, Math.max(1, n)) : 4;

  let summary;
  try {
    summary = await runFanOut(context.env, { maxDeals });
  } catch (e) {
    await logOp(context.env, 'fan-out', false, { error: e.message });
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }

  await logOp(context.env, 'fan-out', true, summary);
  return Response.json({ ok: true, ...summary }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) { return handle(context); }
export async function onRequestGet(context) { return handle(context); }
