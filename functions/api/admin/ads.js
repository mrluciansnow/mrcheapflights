// Ad-automation admin API.
//   GET  /api/admin/ads  — dashboard: health, connected accounts, campaigns+CPA
//   POST /api/admin/ads  — create a draft campaign, then launch it PAUSED
//                          (dry-run unless ADS_LIVE=1 and the platform is set up)

import { requireAdmin } from '../../_lib/auth.js';
import { planCampaign, launchCampaign, adsHealth, adsActivity, adsAdvice } from '../../_lib/ads-engine.js';

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const health = await adsHealth(context.env);

  let accounts = [];
  try {
    const a = await context.env.DB.prepare('SELECT platform, account_id, page_id, pixel_id, status FROM ad_accounts').all();
    accounts = a.results || [];
  } catch { /* table may be pre-migration */ }

  // Campaigns joined with live signup counts (via the /c/ slug) → true CPA.
  const { results } = await context.env.DB.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM subscribers s WHERE s.source = c.campaign_slug) AS signups
     FROM ad_campaigns c ORDER BY c.created_at DESC`
  ).all();

  const campaigns = (results || []).map((c) => {
    const spend = (c.last_spend_cents || 0) / 100;
    return {
      ...c,
      daily_budget: (c.daily_budget_cents || 0) / 100,
      target_cpa: c.target_cpa_cents != null ? c.target_cpa_cents / 100 : null,
      spend,
      cpa: c.signups > 0 && spend > 0 ? +(spend / c.signups).toFixed(2) : null,
      symbol: c.region === 'uk' ? '£' : '€',
    };
  });

  const [advice, activity] = await Promise.all([adsAdvice(context.env), adsActivity(context.env)]);
  return Response.json({ health, accounts, campaigns, advice, activity }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const planned = planCampaign(context.env, body);
  if (!planned.ok) return Response.json({ error: planned.error }, { status: 400 });
  const s = planned.spec;

  const ins = await context.env.DB.prepare(
    `INSERT INTO ad_campaigns (platform, name, objective, status, daily_budget_cents, target_cpa_cents,
       campaign_slug, landing_url, region, dry_run)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, 1)`
  ).bind(s.platform, s.name, s.objective, s.dailyBudgetCents, s.targetCpaCents,
         s.campaignSlug, s.landingUrl, s.region).run();

  const id = ins?.meta?.last_row_id;
  const launch = await launchCampaign(context.env, id);

  return Response.json({
    ok: true, id,
    dry_run: launch.dryRun !== false,
    note: launch.note || (launch.ok ? (launch.dryRun ? 'planned (dry run)' : 'created paused') : launch.error),
    launch,
  }, { status: 201 });
}
