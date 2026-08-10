// Weekly marketing report — the whole growth picture in one email, so the
// operator doesn't have to open the dashboard to know what's working.
//
// Answers, in order: is growth up or down; which campaigns earn signups and at
// what CPA; which AD CREATIVE won (per-variant attribution, migration 0025);
// is the referral loop turning; what did the ad robot do unattended.
//
// Pure reporting — reads only, sends nothing on its own, never throws. Every
// query is individually guarded so one missing table can't blank the report.

import { adsAdvice } from './ads-engine.js';

const WEEK = 604800;

async function safe(promise, fallback) {
  try { return (await promise) ?? fallback; } catch { return fallback; }
}

function pctChange(now, prev) {
  if (!prev) return now > 0 ? null : 0; // no baseline — don't fake a %
  return Math.round(((now - prev) / prev) * 100);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function gatherWeekly(env) {
  const db = env.DB;

  const [signups, premium, campaigns, creatives, referrals, topReferrers, adCampaigns, guardrails] = await Promise.all([
    safe(db.prepare(
      `SELECT
         SUM(CASE WHEN created_at >= unixepoch()-${WEEK} THEN 1 ELSE 0 END) AS this_week,
         SUM(CASE WHEN created_at >= unixepoch()-${WEEK * 2} AND created_at < unixepoch()-${WEEK} THEN 1 ELSE 0 END) AS last_week,
         COUNT(*) AS total
       FROM subscribers`).first(), { this_week: 0, last_week: 0, total: 0 }),

    safe(db.prepare(
      `SELECT COUNT(*) AS n FROM subscribers
       WHERE current_period_end IS NOT NULL AND current_period_end > unixepoch()`).first(), { n: 0 }),

    safe(db.prepare(
      `SELECT c.slug, c.name, c.platform, c.spend_cents, c.visits, c.region,
              (SELECT COUNT(*) FROM subscribers s WHERE s.source=c.slug) AS signups,
              (SELECT COUNT(*) FROM subscribers s WHERE s.source=c.slug AND s.created_at >= unixepoch()-${WEEK}) AS signups_7d
       FROM campaigns c WHERE c.active=1
       ORDER BY signups_7d DESC, signups DESC LIMIT 8`).all(), { results: [] }),

    safe(db.prepare(
      `SELECT ac.name AS campaign, ac.region, cr.variant, cr.headline,
              (SELECT COUNT(*) FROM subscribers s
                WHERE s.source=ac.campaign_slug AND s.source_variant=cr.variant) AS signups
       FROM ad_creatives cr JOIN ad_campaigns ac ON ac.id=cr.campaign_id
       WHERE ac.campaign_slug IS NOT NULL
       ORDER BY signups DESC LIMIT 5`).all(), { results: [] }),

    safe(db.prepare(
      `SELECT
         SUM(CASE WHEN referred_by IS NOT NULL AND created_at >= unixepoch()-${WEEK} THEN 1 ELSE 0 END) AS referred_7d,
         SUM(CASE WHEN referred_by IS NOT NULL THEN 1 ELSE 0 END) AS referred_total,
         SUM(COALESCE(referral_rewarded,0)) AS rewards_granted
       FROM subscribers`).first(), { referred_7d: 0, referred_total: 0, rewards_granted: 0 }),

    safe(db.prepare(
      `SELECT COALESCE(name, email) AS who, referral_count FROM subscribers
       WHERE COALESCE(referral_count,0) > 0 ORDER BY referral_count DESC LIMIT 3`).all(), { results: [] }),

    safe(db.prepare(
      `SELECT name, platform, status, region, last_spend_cents, last_clicks, campaign_slug,
              (SELECT COUNT(*) FROM subscribers s WHERE s.source=ad_campaigns.campaign_slug) AS signups
       FROM ad_campaigns WHERE status IN ('active','paused') ORDER BY last_spend_cents DESC LIMIT 6`).all(), { results: [] }),

    safe(db.prepare(
      `SELECT COUNT(*) AS n FROM ad_actions
       WHERE action='guardrail' AND created_at >= unixepoch()-${WEEK}`).first(), { n: 0 }),
  ]);

  const advice = await safe(adsAdvice(env), []);

  return {
    signups, premium, advice,
    campaigns: campaigns.results || [],
    creatives: (creatives.results || []).filter((c) => c.signups > 0),
    referrals, topReferrers: topReferrers.results || [],
    adCampaigns: adCampaigns.results || [],
    guardrails: guardrails.n || 0,
  };
}

export function renderWeekly(data) {
  const s = data.signups || {};
  const thisWeek = s.this_week || 0, lastWeek = s.last_week || 0;
  const delta = pctChange(thisWeek, lastWeek);
  const deltaColor = delta == null ? '#888' : delta >= 0 ? '#22c55e' : '#e0004d';
  const deltaLabel = delta == null ? 'first week of data' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last week`;
  const sym = (r) => (r === 'uk' ? '£' : '€');

  const campaignRows = data.campaigns.length ? data.campaigns.map((c) => {
    const spend = (c.spend_cents || 0) / 100;
    const cpa = spend > 0 && c.signups > 0 ? sym(c.region) + (spend / c.signups).toFixed(2) : '—';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${esc(c.name)}</strong><br><span style="font-size:11px;color:#999">${esc(c.platform)} · /c/${esc(c.slug)}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${c.visits || 0}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:800;color:#e0004d">${c.signups_7d || 0}<span style="color:#bbb;font-weight:400"> / ${c.signups || 0}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${spend > 0 ? sym(c.region) + spend.toFixed(2) : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700">${cpa}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="padding:12px;color:#888;text-align:center">No active campaigns</td></tr>`;

  const creativeHtml = data.creatives.length ? `
    <h2>✨ Winning ad creative</h2>
    <p style="font-size:12px;color:#888;margin:0 0 8px">Signups attributed to the exact copy that earned them (per-variant links).</p>
    <table>${data.creatives.map((c, i) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;width:26px">${i === 0 ? '🏆' : '&nbsp;'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${esc(c.headline || '(no headline)')}</strong><br><span style="font-size:11px;color:#999">${esc(c.campaign)} · variant ${String.fromCharCode(65 + (c.variant || 0))}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:800;color:#e0004d;white-space:nowrap">${c.signups} signup${c.signups === 1 ? '' : 's'}</td>
    </tr>`).join('')}</table>` : '';

  const r = data.referrals || {};
  const referralHtml = `
    <h2>🔗 Referral loop</h2>
    <div class="stat-row">
      <div class="stat"><div class="num">${r.referred_7d || 0}</div><div class="lbl">Referred (7d)</div></div>
      <div class="stat"><div class="num" style="color:#888">${r.referred_total || 0}</div><div class="lbl">Referred total</div></div>
      <div class="stat"><div class="num" style="color:#22c55e">${r.rewards_granted || 0}</div><div class="lbl">Rewards granted</div></div>
    </div>
    ${data.topReferrers.length ? `<p style="font-size:13px;color:#333;margin:0">Top referrers: ${data.topReferrers.map((t) => `<strong>${esc(t.who)}</strong> (${t.referral_count})`).join(' · ')}</p>`
      : '<p style="font-size:12px;color:#aaa;margin:0">No referrals yet — the share block is live on the homepage for logged-in members.</p>'}`;

  const adsHtml = data.adCampaigns.length ? `
    <h2>🤖 Ad automation</h2>
    <table>${data.adCampaigns.map((a) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${esc(a.name)}</strong><br><span style="font-size:11px;color:#999">${esc(a.platform)} · ${esc(a.status)}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${sym(a.region)}${((a.last_spend_cents || 0) / 100).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${a.last_clicks || 0} clicks</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700">${a.signups || 0} signups</td>
    </tr>`).join('')}</table>
    ${data.guardrails ? `<p style="font-size:13px;color:#e0004d;margin:8px 0 0"><strong>⏸ ${data.guardrails}</strong> campaign(s) auto-paused by the CPA guardrail this week.</p>` : ''}` : '';

  const adviceHtml = data.advice.length ? `
    <h2>🧠 Suggestions</h2>
    <ul style="font-size:13px;padding-left:18px;margin:0;color:#333">
      ${data.advice.slice(0, 6).map((a) => `<li style="margin:4px 0;color:${a.level === 'warn' ? '#b45309' : a.level === 'good' ? '#15803d' : '#555'}">${esc(a.text)}</li>`).join('')}
    </ul>` : '';

  const today = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:0}
  .wrap{max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .header{background:linear-gradient(135deg,#0a1628,#1a2e4a);padding:28px 32px;color:#fff}
  .header h1{margin:0 0 4px;font-size:22px;font-weight:800}
  .header p{margin:0;color:rgba(255,255,255,.6);font-size:13px}
  .body{padding:24px 32px}
  h2{font-size:15px;font-weight:800;color:#0a1628;margin:26px 0 10px;border-left:3px solid #ffd200;padding-left:10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  .stat-row{display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap}
  .stat{background:#f8fafc;border-radius:10px;padding:14px 18px;flex:1;min-width:120px;text-align:center}
  .stat .num{font-size:26px;font-weight:900;color:#0a1628}
  .stat .lbl{font-size:11px;color:#888;font-weight:600;text-transform:uppercase;margin-top:2px}
  .footer{background:#f8fafc;padding:16px 32px;font-size:11px;color:#aaa;text-align:center}
  .btn{display:inline-block;background:#ffd200;color:#0a1628;font-weight:800;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px}
</style></head>
<body><div class="wrap">
  <div class="header"><h1>📈 Weekly Marketing Report</h1><p>Week ending ${today}</p></div>
  <div class="body">
    <div class="stat-row">
      <div class="stat"><div class="num">${thisWeek}</div><div class="lbl">Signups (7d)</div></div>
      <div class="stat"><div class="num" style="color:${deltaColor};font-size:19px;padding-top:5px">${deltaLabel}</div><div class="lbl">Trend</div></div>
      <div class="stat"><div class="num" style="color:#e0004d">${data.premium?.n || 0}</div><div class="lbl">Premium</div></div>
      <div class="stat"><div class="num" style="color:#888">${s.total || 0}</div><div class="lbl">Total members</div></div>
    </div>

    <h2>📣 Campaign performance</h2>
    <table>
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Campaign</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Visits</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Signups 7d/all</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Spend</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">CPA</th>
      </tr></thead>
      <tbody>${campaignRows}</tbody>
    </table>

    ${creativeHtml}
    ${referralHtml}
    ${adsHtml}
    ${adviceHtml}

    <p style="margin:22px 0 0"><a class="btn" href="https://mrcheapflights.ie/marketing">Open the marketing dashboard →</a></p>
  </div>
  <div class="footer">Mr Cheap Flights · weekly marketing report</div>
</div></body></html>`;

  const text = `Weekly Marketing Report — week ending ${today}

Signups (7d): ${thisWeek}${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta}% vs last week)`}
Premium members: ${data.premium?.n || 0}
Total members: ${s.total || 0}
Referred signups (7d): ${r.referred_7d || 0}
${data.creatives.length ? `Top creative: "${data.creatives[0].headline}" — ${data.creatives[0].signups} signups` : ''}

Open https://mrcheapflights.ie/marketing for the full dashboard.`;

  const subject = `📈 MCF Weekly — ${thisWeek} signup${thisWeek === 1 ? '' : 's'}${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta}%)`}${data.guardrails ? ` · ⏸ ${data.guardrails} auto-paused` : ''}`;

  return { html, text, subject, stats: { thisWeek, lastWeek, delta, premium: data.premium?.n || 0 } };
}

export async function buildWeeklyReport(env) {
  const data = await gatherWeekly(env);
  return renderWeekly(data);
}
