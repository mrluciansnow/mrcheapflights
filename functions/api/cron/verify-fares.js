// POST/GET /api/cron/verify-fares — fare-verification sweep over live deals.
// Auth: admin session OR Bearer <CRON_SECRET> (same dual pattern as the rest).
// cron-job.org schedule: every 8h (00:15 / 08:15 / 16:15 Europe/London) —
// 3 runs/day × 1 Google check/run ≈ 90 SerpApi searches/month, inside the
// free 100. Travelpayouts checks are free and run broadly.
//
// Optional query overrides for manual runs: ?deals=20&google=3

import { requireAdmin } from '../../_lib/auth.js';
import { logOp } from '../../_lib/oplog.js';
import { runFareChecks } from '../../_lib/fares.js';

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
  const maxDeals = Math.min(40, parseInt(url.searchParams.get('deals')) || 15);
  const maxGoogle = Math.min(10, parseInt(url.searchParams.get('google')) || 1);

  let summary;
  try {
    summary = await runFareChecks(context.env, { maxDeals, maxGoogle });
  } catch (e) {
    await logOp(context.env, 'fares', false, { error: e.message });
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }

  await logOp(context.env, 'fares', true, summary);
  return Response.json({ ok: true, ...summary });
}

export async function onRequestPost(context) { return handle(context); }
export async function onRequestGet(context) { return handle(context); }
