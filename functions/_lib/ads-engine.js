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
//
//  SANDBOX: a "filler" token that starts with `sandbox` (or ADS_SANDBOX=1) puts
//  that platform into SIMULATION — fake campaign ids + fabricated, growing
//  metrics — so the full lifecycle is demoable/testable without a real ad
//  account. Sandbox short-circuits BEFORE any network call, so it can never
//  spend, even with ADS_LIVE=1.
// ─────────────────────────────────────────────────────────────────────────────

import { logOp } from './oplog.js';
import * as meta from './ads-meta.js';
import * as tiktok from './ads-tiktok.js';

const PLATFORMS = new Set(['meta', 'tiktok']);
const OBJECTIVES = new Set(['traffic', 'reach', 'engagement']);
// Enough spend must accumulate before the CPA guardrail trusts a number —
// otherwise one early signup makes a fine campaign look terrible (or vice versa).
const GUARDRAIL_MIN_SPEND_CENTS = 1000; // €10 / £10

// ── Sandbox / simulation ─────────────────────────────────────────────────────
function platformToken(env, platform) {
  return String((platform === 'meta' ? env.META_ACCESS_TOKEN : env.TIKTOK_ACCESS_TOKEN) || '').trim();
}
// A platform is in sandbox when its token is a filler (`sandbox…`) or ADS_SANDBOX=1.
function isSandbox(env, platform) {
  const t = platformToken(env, platform);
  return !!t && (env.ADS_SANDBOX === '1' || /^sandbox/i.test(t));
}
// Deterministic pseudo-random in [0,1) seeded by n — keeps a campaign's
// simulated CPM/CTR stable across syncs while spend grows.
function seeded(n) { const x = Math.sin(n * 99.13) * 10000; return x - Math.floor(x); }
// One simulated sync step for an ACTIVE sandbox campaign: advance spend by ~1/6
// of the daily budget and derive plausible impressions/clicks. Paused campaigns
// freeze at their stored values (spend only accrues while delivering).
function simulateStep(row) {
  if (row.status !== 'active') {
    return { spendCents: row.last_spend_cents || 0, impressions: row.last_impressions || 0, clicks: row.last_clicks || 0, results: row.last_results || 0 };
  }
  const daily = row.daily_budget_cents || 0;
  const step = Math.max(50, Math.round((daily / 6) * (0.8 + 0.4 * seeded(row.id))));
  const spendCents = Math.min((row.last_spend_cents || 0) + step, daily * 30);
  const cpmCents = 400 + Math.round(350 * seeded(row.id + 1)); // €4.00–7.50 CPM
  const impressions = cpmCents > 0 ? Math.round((spendCents / cpmCents) * 1000) : 0;
  const ctr = 0.008 + 0.014 * seeded(row.id + 2);              // 0.8–2.2% CTR
  const clicks = Math.round(impressions * ctr);
  return { spendCents, impressions, clicks, results: clicks };
}
function simulateCreate(platform) {
  const rnd = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 12);
  return { ext_campaign_id: `sim_${platform}_${rnd}`, ext_adset_id: `sim_set_${rnd}`, adset_error: null };
}

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
  if (isSandbox(env, platform)) return true; // sandbox needs no real ad account
  return platform === 'meta' ? meta.metaConfigured(env, account) : tiktok.tiktokConfigured(env, account);
}

// ── Health / diagnostics (shape only — never leaks token contents) ───────────
export async function adsHealth(env) {
  const mode = adsMode(env);
  const out = { mode: { live: mode.live, allow_scale: mode.allowScale, max_daily_budget: mode.maxDailyBudgetCents / 100 }, platforms: {} };
  for (const p of PLATFORMS) {
    const account = await getAccount(env, p);
    const sandbox = isSandbox(env, p);
    out.platforms[p] = {
      token_present: p === 'meta' ? !!env.META_ACCESS_TOKEN : !!env.TIKTOK_ACCESS_TOKEN,
      account_set: sandbox || !!(account?.account_id || (p === 'meta' ? env.META_AD_ACCOUNT_ID : env.TIKTOK_ADVERTISER_ID)),
      configured: configuredFor(env, p, account),
      sandbox,
      status: sandbox ? 'sandbox' : (account?.status || 'disconnected'),
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

  // Live path — create the PAUSED campaign + its budget-carrying child. Sandbox
  // short-circuits to a simulator; nothing is sent to a real platform.
  const sandbox = isSandbox(env, row.platform);
  let created;
  if (sandbox) {
    created = simulateCreate(row.platform);
  } else if (row.platform === 'meta') {
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

  const note = sandbox
    ? 'SANDBOX — simulated campaign (no real platform, no spend). Activate to start simulated delivery.'
    : (created.adset_error ? 'campaign created PAUSED; ad set needs attention: ' + created.adset_error : 'created PAUSED — activate in Ads Manager to spend');
  await env.DB.prepare(
    `UPDATE ad_campaigns SET ext_campaign_id=?, ext_adset_id=?, status='paused', dry_run=0,
       note=?, updated_at=unixepoch() WHERE id=?`
  ).bind(created.ext_campaign_id, created.ext_adset_id, note, campaignId).run();
  await logAction(env, campaignId, row.platform, 'create', true, false, { ...plan, ...created, sandbox });
  return { ok: true, dryRun: false, sandbox, note, ...created };
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
  const sandbox = isSandbox(env, row.platform);
  const canWrite = mode.live && configuredFor(env, row.platform, account) && row.ext_campaign_id;

  // Real platform call only when NOT sandbox. Sandbox just flips local state.
  if (canWrite && !sandbox) {
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
  // Stamp first-activation time (drives "live since" + sandbox spend accrual).
  const stamp = target === 'active' && !row.activated_at ? ', activated_at=unixepoch()' : '';
  await env.DB.prepare(`UPDATE ad_campaigns SET status=?${stamp}, updated_at=unixepoch() WHERE id=?`).bind(target, campaignId).run();
  await logAction(env, campaignId, row.platform, target === 'active' ? 'activate' : 'pause', true, !canWrite, { target, applied: canWrite, sandbox });
  return { ok: true, dryRun: !canWrite, sandbox, status: target };
}

// ── Sync one campaign's spend/metrics from the platform ──────────────────────
async function syncOne(env, row, account) {
  if (!row.ext_campaign_id) return null; // never launched — nothing to sync
  let r;
  if (isSandbox(env, row.platform)) r = { ok: true, insights: simulateStep(row) };
  else if (row.platform === 'meta') r = await meta.metaInsights(env, row.ext_campaign_id);
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
  let signups = 0;
  if (row.campaign_slug) {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE source=?').bind(row.campaign_slug).first();
    signups = r?.n || 0;
  }
  if (signups && row.last_spend_cents) return { signups, cpaCents: Math.round(row.last_spend_cents / signups) };
  // Sandbox has no real signups, so fall back to cost-per-result (simulated
  // clicks) as the denominator — lets the guardrail be demonstrated end-to-end.
  if (isSandbox(env, row.platform) && row.last_results > 0 && row.last_spend_cents) {
    return { signups: row.last_results, cpaCents: Math.round(row.last_spend_cents / row.last_results), simulated: true };
  }
  return { signups, cpaCents: null };
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
    // Re-read the full row so the check sees the freshly-synced numbers.
    const fresh = await env.DB.prepare('SELECT * FROM ad_campaigns WHERE id=?').bind(row.id).first();
    if (fresh && fresh.status === 'active' && fresh.target_cpa_cents && fresh.last_spend_cents >= GUARDRAIL_MIN_SPEND_CENTS) {
      const cpa = await cpaForCampaign(env, fresh);
      if (cpa && cpa.cpaCents != null && cpa.cpaCents > fresh.target_cpa_cents) {
        const res = await setCampaignStatus(env, fresh.id, 'paused');
        await env.DB.prepare("UPDATE ad_campaigns SET note=? WHERE id=?")
          .bind(`auto-paused: CPA ${symbolFor(fresh.region)}${(cpa.cpaCents / 100).toFixed(2)} > target ${symbolFor(fresh.region)}${(fresh.target_cpa_cents / 100).toFixed(2)}${cpa.simulated ? ' (sandbox)' : ''}`, fresh.id).run();
        await logAction(env, fresh.id, fresh.platform, 'guardrail', true, res.dryRun, { cpaCents: cpa.cpaCents, targetCents: fresh.target_cpa_cents, simulated: !!cpa.simulated });
        summary.paused_by_guardrail.push({ id: fresh.id, name: fresh.name, cpa: cpa.cpaCents / 100 });
      }
    }
  }

  await logOp(env, 'ads-sync', true, summary);
  return summary;
}

// ── Observability (read-only, always safe) ───────────────────────────────────
// Recent automation activity — the answer to "what did the robot do overnight?".
export async function adsActivity(env, limit = 15) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.action, a.ok, a.dry_run, a.platform, a.created_at, c.name AS campaign
       FROM ad_actions a LEFT JOIN ad_campaigns c ON c.id = a.campaign_id
       ORDER BY a.id DESC LIMIT ?`
    ).bind(Math.min(50, Math.max(1, limit))).all();
    return (results || []).map((r) => ({
      action: r.action, ok: !!r.ok, dry_run: !!r.dry_run,
      platform: r.platform, campaign: r.campaign || null, at: r.created_at,
    }));
  } catch { return []; }
}

// Plain-language advisories from the current state. Advice only — never acts.
export async function adsAdvice(env) {
  const advice = [];
  const mode = adsMode(env);
  const health = await adsHealth(env);
  for (const p of ['meta', 'tiktok']) {
    if (health.platforms[p].sandbox) {
      advice.push({ level: 'info', text: `${p === 'meta' ? 'Meta' : 'TikTok'} is in SANDBOX — campaigns simulate delivery; all metrics are fake and nothing spends. Swap in a real token to go live.` });
    } else if (!health.platforms[p].token_present) {
      advice.push({ level: 'info', text: `${p === 'meta' ? 'Meta' : 'TikTok'} token not set — its campaigns stay in dry-run.` });
    }
  }
  if (!mode.live && !isSandbox(env, 'meta') && !isSandbox(env, 'tiktok')) {
    advice.push({ level: 'info', text: 'Dry-run mode — campaigns are planned & logged but never sent. Set ADS_LIVE=1 to arm.' });
  }

  let camps = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM subscribers s WHERE s.source=c.campaign_slug) AS signups FROM ad_campaigns c`
    ).all();
    camps = results || [];
  } catch { return advice; }

  const drafts = camps.filter((c) => c.status === 'draft').length;
  if (drafts) advice.push({ level: 'warn', text: `${drafts} draft campaign${drafts > 1 ? 's' : ''} not yet launched.` });

  for (const c of camps) {
    const sym = c.region === 'uk' ? '£' : '€';
    if ((c.status === 'active' || c.status === 'paused') && c.target_cpa_cents == null) {
      advice.push({ level: 'warn', text: `"${c.name}" has no target CPA — the auto-pause guardrail can't protect it.` });
    }
    if (c.status === 'active' && c.signups > 0 && c.last_spend_cents > 0 && c.target_cpa_cents) {
      const cpaCents = Math.round(c.last_spend_cents / c.signups);
      if (cpaCents <= c.target_cpa_cents * 0.6) {
        advice.push({ level: 'good', text: `"${c.name}" CPA ${sym}${(cpaCents / 100).toFixed(2)} is well under target — a scale candidate.` });
      } else if (cpaCents > c.target_cpa_cents) {
        advice.push({ level: 'warn', text: `"${c.name}" CPA ${sym}${(cpaCents / 100).toFixed(2)} is over target — the guardrail will pause it on the next sync.` });
      }
    }
  }
  return advice;
}
