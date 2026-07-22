// TikTok Marketing API client — Business API v1.3.
//
// Same defensive contract as ads-meta.js: no-ops without a token/advertiser,
// AbortController timeout, returns { ok, data, error }. TikTok auths via an
// "Access-Token" header (not a query param) and wraps every response in a
// { code, message, data } envelope where code:0 means success.
//
// SAFETY: campaigns/ad groups are created with operation_status DISABLE
// (paused). Nothing here enables a campaign — going live is a human step.
//
// Token: env.TIKTOK_ACCESS_TOKEN. Advertiser: ad_accounts.account_id or
// env.TIKTOK_ADVERTISER_ID.

const BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export function tiktokConfigured(env, account) {
  return !!(env.TIKTOK_ACCESS_TOKEN && (account?.account_id || env.TIKTOK_ADVERTISER_ID));
}

function advId(env, account) {
  return String(account?.account_id || env.TIKTOK_ADVERTISER_ID || '').trim();
}

async function ttApi(env, path, { method = 'GET', query = {}, body = null } = {}) {
  const token = String(env.TIKTOK_ACCESS_TOKEN || '').trim();
  if (!token) return { ok: false, error: 'TIKTOK_ACCESS_TOKEN not set' };

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 15000);
  try {
    let url = `${BASE}${path}`;
    const init = { method, signal: controller.signal, headers: { 'Access-Token': token } };
    if (method === 'GET') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      const s = qs.toString();
      if (s) url += '?' + s;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body || {});
    }
    const res = await fetch(url, init);
    clearTimeout(to);
    const env_ = await res.json().catch(() => null);
    // TikTok always returns HTTP 200; the real status is in the code field.
    if (!res.ok || !env_ || env_.code !== 0) {
      return { ok: false, error: env_?.message || `HTTP ${res.status}`, data: env_ };
    }
    return { ok: true, data: env_.data };
  } catch (e) {
    clearTimeout(to);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

const TT_OBJECTIVE = {
  traffic: 'TRAFFIC',
  reach: 'REACH',
  engagement: 'ENGAGEMENT',
};

// Create a campaign (budget carried at the ad-group level below). TikTok has no
// campaign-level paused flag on create; the paused state is enforced by the ad
// group's operation_status DISABLE.
export async function tiktokCreateCampaign(env, account, { name, objective }) {
  return ttApi(env, '/campaign/create/', {
    method: 'POST',
    body: {
      advertiser_id: advId(env, account),
      campaign_name: name,
      objective_type: TT_OBJECTIVE[objective] || TT_OBJECTIVE.traffic,
      budget_mode: 'BUDGET_MODE_INFINITE',
    },
  });
}

// Create a DISABLED (paused) ad group with the daily budget + geo. TikTok wants
// budget in major currency units (e.g. 20.00), so we convert from cents.
export async function tiktokCreateAdGroup(env, account, { name, campaignId, dailyBudgetCents, region, locationIds }) {
  return ttApi(env, '/adgroup/create/', {
    method: 'POST',
    body: {
      advertiser_id: advId(env, account),
      campaign_id: campaignId,
      adgroup_name: name,
      promotion_type: 'WEBSITE',
      placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
      budget_mode: 'BUDGET_MODE_DAY',
      budget: +(dailyBudgetCents / 100).toFixed(2),
      schedule_type: 'SCHEDULE_FROM_NOW',
      optimization_goal: 'CLICK',
      billing_event: 'CPC',
      // location_ids are TikTok's own geo codes; caller supplies them when known
      // (IE / GB). Left empty the ad group is created but needs geo set in-UI.
      location_ids: locationIds || [],
      operation_status: 'DISABLE',
    },
  });
}

// Flip campaign status. Engine only ever passes 'DISABLE'.
export async function tiktokSetStatus(env, account, campaignId, operationStatus) {
  return ttApi(env, '/campaign/status/update/', {
    method: 'POST',
    body: {
      advertiser_id: advId(env, account),
      campaign_ids: [campaignId],
      operation_status: operationStatus, // 'ENABLE' | 'DISABLE'
    },
  });
}

// Lifetime-ish report for a campaign. Normalises to integer cents.
export async function tiktokReport(env, account, campaignId) {
  const r = await ttApi(env, '/report/integrated/get/', {
    method: 'GET',
    query: {
      advertiser_id: advId(env, account),
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: ['campaign_id'],
      metrics: ['spend', 'impressions', 'clicks'],
      filtering: [{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([campaignId]) }],
      start_date: '2020-01-01',
      end_date: new Date().toISOString().slice(0, 10),
      page_size: 1,
    },
  });
  if (!r.ok) return r;
  const row = r.data?.list?.[0]?.metrics || {};
  return {
    ok: true,
    insights: {
      spendCents: Math.round(parseFloat(row.spend || '0') * 100),
      impressions: parseInt(row.impressions || '0', 10),
      clicks: parseInt(row.clicks || '0', 10),
      results: parseInt(row.clicks || '0', 10),
    },
  };
}
