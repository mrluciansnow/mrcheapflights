// POST/GET /api/cron/ads-sync — pull spend/metrics for every launched ad
// campaign and run the auto-pause guardrail. Dual auth: admin session OR
// Bearer <CRON_SECRET> (same pattern as verify-fares).
//
// Safe by construction: with no platform tokens set (the default) every action
// is a dry run — it reports what it would do and changes nothing. The only
// unattended live write it can ever make is PAUSING an over-target campaign.
//
// Suggested schedule: every 6h. ?debug=1 appends the (shape-only) health block.

import { requireAdmin } from '../../_lib/auth.js';
import { logOp } from '../../_lib/oplog.js';
import { runAdsSync, adsHealth } from '../../_lib/ads-engine.js';

async function handle(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!context.env.CRON_SECRET || provided !== context.env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let summary;
  try {
    summary = await runAdsSync(context.env);
  } catch (e) {
    await logOp(context.env, 'ads-sync', false, { error: e.message });
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }

  const url = new URL(context.request.url);
  if (url.searchParams.get('debug') === '1') {
    summary.health = await adsHealth(context.env);
  }
  return Response.json({ ok: true, ...summary }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) { return handle(context); }
export async function onRequestGet(context) { return handle(context); }
