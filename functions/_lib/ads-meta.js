// Meta (Facebook/Instagram) Marketing API client — Graph API v21.0.
//
// Deliberately thin and defensive, mirroring _lib/fares.js: every call no-ops
// cleanly when the token/account is missing, wraps fetch in an AbortController
// timeout, and returns a plain { ok, data, error } shape instead of throwing.
//
// SAFETY: metaCreateCampaign forces status:'PAUSED'. Nothing here ever creates
// or flips a campaign to ACTIVE — starting spend is a human step in Ads Manager
// (or an explicit admin action), never an automated one. The one write the
// engine calls unattended is metaSetStatus(..., 'PAUSED'), which only ever
// reduces spend.
//
// Token: env.META_ACCESS_TOKEN (a long-lived System User or Page token with
// ads_management). Account: ad_accounts.account_id or env.META_AD_ACCOUNT_ID,
// the numeric id WITHOUT the "act_" prefix.

const GRAPH = 'https://graph.facebook.com/v21.0';

export function metaConfigured(env, account) {
  return !!(env.META_ACCESS_TOKEN && (account?.account_id || env.META_AD_ACCOUNT_ID));
}

function acctId(env, account) {
  const raw = String(account?.account_id || env.META_AD_ACCOUNT_ID || '').trim();
  return raw.replace(/^act_/, '');
}

// Low-level Graph call. `params` are form-encoded for POST, query for GET.
async function metaApi(env, path, { method = 'GET', params = {} } = {}) {
  const token = String(env.META_ACCESS_TOKEN || '').trim();
  if (!token) return { ok: false, error: 'META_ACCESS_TOKEN not set' };

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 15000);
  try {
    let url = `${GRAPH}/${path}`;
    const init = { method, signal: controller.signal };
    const all = { ...params, access_token: token };
    if (method === 'GET') {
      url += '?' + new URLSearchParams(all).toString();
    } else {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(all)) {
        form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      init.body = form;
    }
    const res = await fetch(url, init);
    clearTimeout(to);
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) {
      return { ok: false, error: body?.error?.message || `HTTP ${res.status}`, data: body };
    }
    return { ok: true, data: body };
  } catch (e) {
    clearTimeout(to);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

// Map our generic objective → Meta's ODAX objective enum.
const META_OBJECTIVE = {
  traffic: 'OUTCOME_TRAFFIC',
  reach: 'OUTCOME_AWARENESS',
  engagement: 'OUTCOME_ENGAGEMENT',
};

// Create a PAUSED campaign shell. Budget is set at the ad-set level (below).
// special_ad_categories is required by Meta (empty array = none).
export async function metaCreateCampaign(env, account, { name, objective }) {
  const id = acctId(env, account);
  return metaApi(env, `act_${id}/campaigns`, {
    method: 'POST',
    params: {
      name,
      objective: META_OBJECTIVE[objective] || META_OBJECTIVE.traffic,
      status: 'PAUSED',
      special_ad_categories: [],
    },
  });
}

// Create a PAUSED ad set carrying the daily budget + geo targeting. Meta wants
// the budget in minor units (cents) as a string. LINK_CLICKS optimisation keeps
// this a simple traffic driver to the /c/ landing page.
export async function metaCreateAdSet(env, account, { name, campaignId, dailyBudgetCents, region }) {
  const id = acctId(env, account);
  const country = region === 'uk' ? 'GB' : 'IE';
  return metaApi(env, `act_${id}/adsets`, {
    method: 'POST',
    params: {
      name,
      campaign_id: campaignId,
      daily_budget: String(dailyBudgetCents),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: { geo_locations: { countries: [country] } },
      status: 'PAUSED',
    },
  });
}

// Flip a campaign's status. Guarded by the caller — the engine only ever passes
// 'PAUSED'; 'ACTIVE' is reachable solely via an explicit admin request.
export async function metaSetStatus(env, campaignId, status) {
  return metaApi(env, `${campaignId}`, { method: 'POST', params: { status } });
}

// Lifetime insights for a campaign. Meta returns spend as a decimal string in
// the account currency; we normalise to integer cents.
export async function metaInsights(env, campaignId) {
  const r = await metaApi(env, `${campaignId}/insights`, {
    method: 'GET',
    params: { fields: 'spend,impressions,clicks,actions', date_preset: 'maximum' },
  });
  if (!r.ok) return r;
  const row = r.data?.data?.[0] || {};
  const linkClicks = (row.actions || []).find((a) => a.action_type === 'link_click');
  return {
    ok: true,
    insights: {
      spendCents: Math.round(parseFloat(row.spend || '0') * 100),
      impressions: parseInt(row.impressions || '0', 10),
      clicks: parseInt(row.clicks || '0', 10),
      results: linkClicks ? parseInt(linkClicks.value || '0', 10) : 0,
    },
  };
}
