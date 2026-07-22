// Ad-automation orchestrator — the brain that sits between the admin UI / cron
// and the platform clients. It plans campaigns, launches them PAUSED, syncs
// spend from the platforms, joins that against internal /c/ attribution to get a
// true CPA, and enforces guardrails.
//
// ─────────────────────────────────────────────────────────────────────────────
// SAFETY MODEL — read before touching this file.
//
//  1. DRY-RUN BY DEFAULT. No platform write happens unless env.ADS_LIVE === '1'
//     AND the platform is configured (token + account). Otherwise the intended
//     request is planned and logged to ad_actions, but never sent.
//  2. PAUSED-ONLY CREATION. launchCampaign creates the campaign PAUSED. The
//     engine NEVER activates a campaign. Going live (spending money) is a human
//     action — an explicit admin "Activate" click, or done in Ads Manager where
//     the payment method and final review live.
//  3. HARD BUDGET CEILING. planCampaign refuses any daily budget above
//     ADS_MAX_DAILY_BUDGET (major currency units, default 20).
//  4. GUARDRAIL ONLY PAUSES. The automated rule can pause an over-target
//     campaign (spend ↓, always safe). It never raises budgets or activates
//     unless ADS_ALLOW_SCALE === '1' — and even then only within the ceiling.
//
// The effect: with no tokens set (the default, and the state overnight), the
// whole system is inert — it plans and reports but touches nothing external.
// ─────────────────────────────────────────────────────────────────────────────

import { logOp } from './oplog.js';
import * as meta from './ads-meta.js';
import * as tiktok from './ads-tiktok.js';

const PLATFORMS = new Set(['meta', 'tiktok']);
const OBJECTIVES = new Set(['traffic', 'reach', 'engagement']);
// Enough spend must accumulate before the CPA guardrail trusts a number —
// otherwise one early signup makes a fine campaign look terrible (or vice versa).
const GUARDRAIL_MIN_SPEND_CENTS = 1000; // €10 / £10

export function adsMode(env) {
  const maxMajor = parseFloat(env.ADS_MAX_DAILY_BUDGET || '20');
  return {
    live: env.ADS_LIVE === '1',
    allowScale: env.ADS_ALLOW_SCALE === '1',
    maxDailyBudgetCents: Math.round((Number.isFinite(maxMajor) ? maxMajor : 20) * 100),
  };
}

function symbolFor(region) { return region === 'uk' ? '£' : '€'; }

async function getAccount(env, platform) {
  try {
    return await env.DB.prepare('SELECT * FROM ad_accounts WHERE platform=?').bind(platform).first();
  } catch { return null; }
}

async function logAction(env, campaignId, platform, action, ok, dryRun, detail) {
  try {
    await env.DB.prepare(
      'INSERT INTO ad_actions (campaign_id, platform, action, ok, dry_run, detail) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(campaignId ?? null, platform ?? null, action, ok ? 1 : 0, dryRun ? 1 : 0,
           detail == null ? null : JSON.stringify(detail).slice(0, 1500)).run();
  } catch { /* audit logging must never break the flow */ }
}

function configuredFor(env, platform, account) {
  return platform === 'meta' ? meta.metaConfigured(env, account) : tiktok.tiktokConfigured(env, account);
}

// ── Health / diagnostics (shape only — never leaks token contents) ───────────
export async function adsHealth(env) {
  const mode = adsMode(env);
  const out = { mode: { live: mode.live, allow_scale: mode.allowScale, max_daily_budget: mode.maxDailyBudgetCents / 100 }, platforms: {} };
  for (const p of PLATFORMS) {
    const account = await getAccount(env, p);
    out.platforms[p] = {
      token_present: p === 'meta' ? !!env.META_ACCESS_TOKEN : !!env.TIKTOK_ACCESS_TOKEN,
      account_set: !!(account?.account_id || (p === 'meta' ? env.META_AD_ACCOUNT_ID : env.TIKTOK_ADVERTISER_ID)),
      configured: configuredFor(env, p, account),
      status: account?.status || 'disconnected',
    };
  }
  return out;
}

// ── Validate + normalise a draft into a safe, launchable spec ────────────────
// Returns { ok, spec } or { ok:false, error }. Enforces the budget ceiling.
export function planCampaign(env, draft) {
  const mode = adsMode(env);
  const platform = String(draft.platform || '').toLowerCase();
  if (!PLATFORMS.has(platform)) return { ok: false, error: 'platform must be meta or tiktok' };

  const name = String(draft.name || '').trim().slice(0, 120);
  if (!name) return { ok: false, error: 'name required' };

  const objective = OBJECTIVES.has(draft.objective) ? draft.objective : 'traffic';
  const region = ['ie', 'uk'].includes(draft.region) ? draft.region : 'ie';

  const budgetMajor = parseFloat(draft.dailyBudget);
  if (!Number.isFinite(budgetMajor) || budgetMajor <= 0) return { ok: false, error: 'dailyBudget must be > 0' };
  const dailyBudgetCents = Math.round(budgetMajor * 100);
  if (dailyBudgetCents > mode.maxDailyBudgetCents) {
    return { ok: false, error: `daily budget ${symbolFor(region)}${budgetMajor} exceeds the ${symbolFor(region)}${mode.maxDailyBudgetCents / 100} ceiling (ADS_MAX_DAILY_BUDGET)` };
  }

  const targetCpaMajor = parseFloat(draft.targetCpa);
  const targetCpaCents = Number.isFinite(targetCpaMajor) && targetCpaMajor > 0 ? Math.round(targetCpaMajor * 100) : null;

  const campaignSlug = draft.campaignSlug ? String(draft.campaignSlug).trim().slice(0, 48) : null;
  const base = region === 'uk' ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const landingUrl = campaignSlug ? `${base}/c/${campaignSlug}` : base;

  return { ok: true, spec: { platform, name, objective, region, dailyBudgetCents, targetCpaCents, campaignSlug, landingUrl } };
}

// ── Launch: create the campaign PAUSED (or plan it, in dry-run) ──────────────
export async function launchCampaign(env, campaignId) {
  const row = await env.DB.prepare('SELECT * FROM ad_campaigns WHERE id=?').bind(campaignId).first();
  if (!row) return { ok: false, error: 'not found' };

  const mode = adsMode(env);
  const account = await getAccount(env, row.platform);
  const canWrite = mode.live && configuredFor(env, row.platform, account);

  const plan = {
    platform: row.platform,
    name: row.name,
    objective: row.objective,
    region: row.region,
    daily_budget: row.daily_budget_cents / 100,
    landing_url: row.landing_url,
    status_on_create: 'PAUSED',
  };

  if (!canWrite) {
    // Dry run — record the intended request, change nothing external.
    await logAction(env, campaignId, row.platform, 'plan', true, true, plan);
    const reason = !mode.live ? 'ADS_LIVE not set — dry run' : 'platform not configured — dry run';
    await env.DB.prepare('UPDATE ad_campaigns SET note=?, updated_at=unixepoch() WHERE id=?').bind(reason, campaignId).run();
    return { ok: true, dryRun: true, plan, note: reason };
  }

  // Live path — create PAUSED campaign + paused budget-carrying child.
  let created;
  if (row.platform === 'meta') {
    const c = await meta.metaCreateCampaign(env, account, { name: row.name, objective: row.objective });
    if (!c.ok) return failLaunch(env, campaignId, row.platform, c.error);
    const extId = c.data.id;
    const s = await meta.metaCreateAdSet(env, account, {
      name: row.name + ' — ad set', campaignId: extId, dailyBudgetCents: row.daily_budget_cents, region: row.region,
    });
    created = { ext_campaign_id: extId, ext_adset_id: s.ok ? s.data.id : null, adset_error: s.ok ? null : s.error };
  } else {
    const c = await tiktok.tiktokCreateCampaign(env, account, { name: row.name, objective: row.objective });
    if (!c.ok) return failLaunch(env, campaignId, row.platform, c.error);
    const extId = c.data.campaign_id;
    const g = await tiktok.tiktokCreateAdGroup(env, account, {
      name: row.name + ' — ad group', campaignId: extId, dailyBudgetCents: row.daily_budget_cents, region: row.region,
    });
    created = { ext_campaign_id: extId, ext_adset_id: g.ok ? g.data.adgroup_id : null, adset_error: g.ok ? null : g.error };
  }

  await env.DB.prepare(
    `UPDATE ad_campaigns SET ext_campaign_id=?, ext_adset_id=?, status='paused', dry_run=0,
       note=?, updated_at=unixepoch() WHERE id=?`
  ).bind(created.ext_campaign_id, created.ext_adset_id,
         created.adset_error ? 'campaign created PAUSED; ad set needs attention: ' + created.adset_error : 'created PAUSED — activate in Ads Manager to spend',
         campaignId).run();
  await logAction(env, campaignId, row.platform, 'create', true, false, { ...plan, ...created });
  return { ok: true, dryRun: false, ...created };
}

async function failLaunch(env, campaignId, platform, error) {
  await env.DB.prepare("UPDATE ad_campaigns SET status='error', note=?, updated_at=unixepoch() WHERE id=?")
    .bind(String(error).slice(0, 200), campaignId).run();
  await logAction(env, campaignId, platform, 'error', false, false, { error });
  return { ok: false, error };
}

// ── Explicit admin actions (a human clicked; still respects config/live) ─────
// pause is always allowed (spend ↓). activate requires live + configured and is
// only ever reached from an admin request, never the cron.
export async function setCampaignStatus(env, campaignId, target) {
  const row = await env.DB.prepare('SELECT * FROM ad_campaigns WHERE id=?').bind(campaignId).first();
  if (!row) return { ok: false, error: 'not found' };
  if (!['paused', 'active', 'archived'].includes(target)) return { ok: false, error: 'bad status' };

  const mode = adsMode(env);
  const account = await getAccount(env, row.platform);
  const canWrite = mode.live && configuredFor(env, row.platform, account) && row.ext_campaign_id;

  if (canWrite) {
    if (row.platform === 'meta') {
      const map = { paused: 'PAUSED', active: 'ACTIVE', archived: 'ARCHIVED' };
      const r = await meta.metaSetStatus(env, row.ext_campaign_id, map[target]);
      if (!r.ok) return { ok: false, error: r.error };
    } else {
      const map = { paused: 'DISABLE', active: 'ENABLE', archived: 'DISABLE' };
      const r = await tiktok.tiktokSetStatus(env, account, row.ext_campaign_id, map[target]);
      if (!r.ok) return { ok: false, error: r.error };
    }
  }
  await env.DB.prepare('UPDATE ad_campaigns SET status=?, updated_at=unixepoch() WHERE id=?').bind(target, campaignId).run();
  await logAction(env, campaignId, row.platform, target === 'active' ? 'activate' : 'pause', true, !canWrite, { target, applied: canWrite });
  return { ok: true, dryRun: !canWrite, status: target };
}

// ── Sync one campaign's spend/metrics from the platform ──────────────────────
async function syncOne(env, row, account) {
  if (!row.ext_campaign_id) return null; // never launched — nothing to sync
  let r;
  if (row.platform === 'meta') r = await meta.metaInsights(env, row.ext_campaign_id);
  else r = await tiktok.tiktokReport(env, account, row.ext_campaign_id);
  if (!r.ok) { await logAction(env, row.id, row.platform, 'sync', false, false, { error: r.error }); return null; }

  const ins = r.insights;
  await env.DB.prepare(
    `UPDATE ad_campaigns SET last_spend_cents=?, last_impressions=?, last_clicks=?, last_results=?,
       last_synced_at=unixepoch(), updated_at=unixepoch() WHERE id=?`
  ).bind(ins.spendCents, ins.impressions, ins.clicks, ins.results, row.id).run();
  return ins;
}

// True CPA = platform spend ÷ subscribers attributed to this campaign's /c/ slug.
async function cpaForCampaign(env, row) {
  if (!row.campaign_slug) return null;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE source=?').bind(row.campaign_slug).first();
  const signups = r?.n || 0;
  if (!signups || !row.last_spend_cents) return { signups, cpaCents: null };
  return { signups, cpaCents: Math.round(row.last_spend_cents / signups) };
}

// ── The cron body: sync every launched campaign, then run the guardrail ──────
export async function runAdsSync(env) {
  const mode = adsMode(env);
  const summary = {
    live: mode.live, synced: 0, paused_by_guardrail: [], scaled: [], errors: 0,
    considered: 0,
  };

  const { results } = await env.DB.prepare(
    "SELECT * FROM ad_campaigns WHERE ext_campaign_id IS NOT NULL AND status IN ('active','paused') ORDER BY id"
  ).all();

  for (const row of results || []) {
    summary.considered++;
    const account = await getAccount(env, row.platform);
    const ins = await syncOne(env, row, account);
    if (ins) summary.synced++;

    // Guardrail: an ACTIVE campaign that has spent enough and blown past its
    // target CPA gets paused. This only reduces spend, so it's safe to automate.
    if (row.status === 'active' && row.target_cpa_cents) {
      const fresh = await env.DB.prepare('SELECT last_spend_cents, campaign_slug FROM ad_campaigns WHERE id=?').bind(row.id).first();
      if (fresh && fresh.last_spend_cents >= GUARDRAIL_MIN_SPEND_CENTS) {
        const cpa = await cpaForCampaign(env, row);
        if (cpa && cpa.cpaCents != null && cpa.cpaCents > row.target_cpa_cents) {
          const res = await setCampaignStatus(env, row.id, 'paused');
          await env.DB.prepare("UPDATE ad_campaigns SET note=? WHERE id=?")
            .bind(`auto-paused: CPA ${symbolFor(row.region)}${(cpa.cpaCents / 100).toFixed(2)} > target ${symbolFor(row.region)}${(row.target_cpa_cents / 100).toFixed(2)}`, row.id).run();
          await logAction(env, row.id, row.platform, 'guardrail', true, res.dryRun, { cpaCents: cpa.cpaCents, targetCents: row.target_cpa_cents });
          summary.paused_by_guardrail.push({ id: row.id, name: row.name, cpa: cpa.cpaCents / 100 });
        }
      }
    }
  }

  await logOp(env, 'ads-sync', true, summary);
  return summary;
}
