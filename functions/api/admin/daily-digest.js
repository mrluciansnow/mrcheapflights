import { requireAdmin } from '../../_lib/auth.js';
import { runScraper } from '../../_lib/scraper.js';
import { sendEmail } from '../../_lib/email.js';
import { getDestination } from '../../_lib/destinations.js';

// POST /api/admin/daily-digest
// Compiles a deal intelligence report and emails it to DIGEST_TO_EMAIL.
// Can be called by admin session OR cron bearer token — same auth as trigger-scrape.
// Optionally triggers a fresh scrape first (?scrape=1).
export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const authHeader = context.request.headers.get('Authorization') || '';
    const cronSecret = context.env.CRON_SECRET;
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!cronSecret || !provided || provided !== cronSecret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const url = new URL(context.request.url);
  const doScrape = url.searchParams.get('scrape') === '1';

  let scrapeResult = null;
  if (doScrape) {
    try { scrapeResult = await runScraper(context.env); } catch { /* non-fatal */ }
  }

  const db = context.env.DB;

  // Gather data in parallel
  const [
    pendingDeals,
    expiringDeals,
    subscriberStats,
    recentSubs,
    newPremium,
    opLog,
    clickStats,
    topClickedDests,
    watchStats,
    topWatchedDests,
  ] = await Promise.all([
    db.prepare(`SELECT id, source_name, route, price, badge, region, confidence, created_at
                FROM scraped_deals WHERE status='pending'
                ORDER BY confidence DESC, created_at DESC LIMIT 20`).all(),
    db.prepare(`SELECT id, route, price, badge, region, expiry
                FROM deals WHERE status='live' AND expiry IS NOT NULL
                AND date(expiry) BETWEEN date('now') AND date('now', '+7 days')
                ORDER BY expiry ASC`).all(),
    db.prepare(`SELECT
                  COUNT(*) as total,
                  SUM(CASE WHEN tier='premium' THEN 1 ELSE 0 END) as premium,
                  SUM(CASE WHEN date(created_at,'unixepoch') >= date('now','-7 days') THEN 1 ELSE 0 END) as new_7d
                FROM subscribers`).first(),
    db.prepare(`SELECT name, email, region, tier, created_at
                FROM subscribers
                WHERE date(created_at,'unixepoch') >= date('now','-24 hours')
                ORDER BY created_at DESC LIMIT 10`).all(),
    db.prepare(`SELECT name, email, region
                FROM subscribers
                WHERE tier='premium'
                AND date(updated_at,'unixepoch') >= date('now','-24 hours')
                ORDER BY updated_at DESC LIMIT 10`).all(),
    db.prepare(`SELECT kind, ok, detail, created_at FROM op_log
                WHERE created_at >= unixepoch() - 86400
                ORDER BY created_at DESC LIMIT 20`).all().catch(() => ({ results: [] })),
    // Business metrics — clicks, alert watchlists, engagement
    db.prepare(`SELECT
                  SUM(CASE WHEN created_at >= unixepoch()-86400 THEN 1 ELSE 0 END) AS clicks_24h,
                  SUM(CASE WHEN created_at >= unixepoch()-604800 THEN 1 ELSE 0 END) AS clicks_7d,
                  SUM(CASE WHEN kind='book' AND created_at >= unixepoch()-86400 THEN 1 ELSE 0 END) AS book_24h,
                  SUM(CASE WHEN kind='fares' AND created_at >= unixepoch()-86400 THEN 1 ELSE 0 END) AS fares_24h
                FROM clicks`).first().catch(() => null),
    db.prepare(`SELECT dest_slug, COUNT(*) AS n FROM clicks
                WHERE created_at >= unixepoch()-604800 AND dest_slug IS NOT NULL
                GROUP BY dest_slug ORDER BY n DESC LIMIT 5`).all().catch(() => ({ results: [] })),
    db.prepare(`SELECT
                  COUNT(*) AS total,
                  SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active,
                  SUM(CASE WHEN created_at >= unixepoch()-86400 THEN 1 ELSE 0 END) AS new_24h
                FROM watchlists`).first().catch(() => null),
    db.prepare(`SELECT dest_slug, COUNT(*) AS n FROM watchlists WHERE active=1
                GROUP BY dest_slug ORDER BY n DESC LIMIT 5`).all().catch(() => ({ results: [] })),
  ]);

  const today = new Date().toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const confPill = (c) => {
    if (c == null) return '<span style="color:#bbb;font-size:11px">—</span>';
    const col = c >= 80 ? '#22c55e' : c >= 50 ? '#f59e0b' : '#ef4444';
    return `<span style="color:${col};font-weight:800;font-size:12px">${c}%</span>`;
  };
  const pendingHtml = pendingDeals.results.length
    ? pendingDeals.results.map(d => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${d.badge} ${d.route}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700;color:#e0004d">${d.price}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${confPill(d.confidence)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#666">${d.source_name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee"><span style="background:${d.region==='ie'?'#169b62':'#012169'};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">${d.region.toUpperCase()}</span></td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="padding:12px;color:#888;text-align:center">No pending deals</td></tr>`;

  // ── Automation health (last 24h, from op_log) ──
  const OP_META = {
    scrape:     { icon: '🔄', label: 'Scrape' },
    enrich:     { icon: '🤖', label: 'AI enrich' },
    newsletter: { icon: '📧', label: 'Newsletter' },
    images:     { icon: '🎨', label: 'Images' },
    cleanup:    { icon: '🧹', label: 'Cleanup' },
    publish:    { icon: '🚀', label: 'Publish' },
    alerts:     { icon: '🔔', label: 'Price alerts' },
    dest_content: { icon: '🗺️', label: 'Destination SEO' },
    fares:      { icon: '🔎', label: 'Fare verification' },
  };
  const opSummary = (kind, detail) => {
    let d; try { d = JSON.parse(detail); } catch { return ''; }
    if (!d) return '';
    switch (kind) {
      case 'scrape': return `${d.sources_checked ?? '?'} sources · ${d.deals_found ?? 0} found · ${d.deals_new ?? 0} new${d.errors?.length ? ` · ⚠️ ${d.errors.length} source error(s)` : ''}`;
      case 'enrich': return d.error ? d.error : `${d.enriched ?? 0} scored · ${d.auto_approved ?? 0} auto-approved${d.auto_published ? ` · ${d.auto_published} straight to live` : ''}`;
      case 'newsletter': return d.armed
        ? `IE ${d.ie?.sent ?? 0}/${d.ie?.subscribers ?? 0} sent · UK ${d.uk?.sent ?? 0}/${d.uk?.subscribers ?? 0} sent`
        : 'shell mode (not armed)';
      case 'images': return `${d.generated ?? 0} hero image(s) generated`;
      case 'alerts': return d.reason
        ? d.reason
        : `${d.deals_scanned ?? 0} deal(s) scanned · ${d.matched ?? 0} matched · ${d.sent ?? 0} alert(s) sent${d.skipped_throttle ? ` · ${d.skipped_throttle} throttled` : ''}`;
      case 'dest_content': return `${d.generated ?? 0} destination guide(s) generated`;
      case 'fares': return `${d.tp_checked ?? 0} TP + ${d.google_checked ?? 0} Google checks · ${d.verified ?? 0} verified${d.price_changed ? ` · ${d.price_changed} price-changed` : ''}${!d.tp_armed ? ' · TP token unset' : ''}${!d.google_armed ? ' · SerpApi unset' : ''}`;
      case 'cleanup': return `${d.rate_limit_purged ?? 0} rate-limit rows · ${d.scraped_rejected_purged ?? 0} rejected deals purged`;
      case 'publish': return `${d.deals ?? 0} deal(s) fanned out`;
      default: return String(detail).slice(0, 80);
    }
  };
  const opsRows = (opLog.results || []).map(r => {
    const meta = OP_META[r.kind] || { icon: '⚙️', label: r.kind };
    const time = new Date(r.created_at * 1000).toLocaleTimeString('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit' });
    return `<tr>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;white-space:nowrap">${r.ok ? '✅' : '❌'} ${meta.icon} <strong>${meta.label}</strong></td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;font-size:12px;color:${r.ok ? '#555' : '#e0004d'}">${opSummary(r.kind, r.detail)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;font-size:12px;color:#999;white-space:nowrap">${time}</td>
    </tr>`;
  }).join('');
  const opsFailed = (opLog.results || []).filter(r => !r.ok).length;
  const opsHtml = (opLog.results || []).length
    ? `<h2>${opsFailed ? '🚨' : '⚙️'} Automation — last 24h${opsFailed ? ` (${opsFailed} FAILED)` : ' (all green)'}</h2>
       <table><tbody>${opsRows}</tbody></table>`
    : '';

  const expiringHtml = expiringDeals.results.length
    ? expiringDeals.results.map(d => {
        const daysLeft = Math.ceil((new Date(d.expiry) - new Date()) / 86400000);
        const urgency = daysLeft <= 2 ? '#e0004d' : daysLeft <= 4 ? '#ff8c00' : '#22c55e';
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${d.route}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700">${d.price}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:${urgency};font-weight:700">${daysLeft}d left</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="3" style="padding:12px;color:#888;text-align:center">No deals expiring this week</td></tr>`;

  const stats = subscriberStats || { total: 0, premium: 0, new_7d: 0 };
  const newSubsHtml = recentSubs.results.length
    ? recentSubs.results.map(s => `<li style="margin:4px 0">${s.name || s.email} <span style="color:#888;font-size:12px">(${s.region?.toUpperCase()} · ${s.tier})</span></li>`).join('')
    : '<li style="color:#888">No new sign-ups in the last 24h</li>';

  const newPremHtml = newPremium.results.length
    ? newPremium.results.map(s => `<li style="margin:4px 0;color:#22c55e">⭐ ${s.name || s.email} <span style="color:#888;font-size:12px">(${s.region?.toUpperCase()})</span></li>`).join('')
    : '<li style="color:#888">No new premium conversions</li>';

  const scrapeHtml = scrapeResult
    ? `<p style="background:#f0fdf4;border:1px solid #bbf7d0;padding:10px 14px;border-radius:8px;font-size:13px">
        ✅ Scrape ran: <strong>${scrapeResult.sources_checked}</strong> sources ·
        <strong>${scrapeResult.deals_found}</strong> deals found ·
        <strong>${scrapeResult.deals_new}</strong> new
        ${scrapeResult.errors.length ? `<br>⚠️ Errors: ${scrapeResult.errors.join(', ')}` : ''}
       </p>`
    : '';

  // ── Business metrics — booking-intent clicks + alert watchlists ──
  const destName = (slug) => getDestination(slug)?.name
    || String(slug || '').replace(/_lh$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const cs = clickStats || { clicks_24h: 0, clicks_7d: 0, book_24h: 0, fares_24h: 0 };
  const ws = watchStats || { total: 0, active: 0, new_24h: 0 };
  const destList = (rows, colour) => (rows?.results || []).length
    ? `<ol style="margin:6px 0 0;padding-left:22px;font-size:13px;color:#333">${
        rows.results.map(r => `<li style="margin:3px 0">${destName(r.dest_slug)} <span style="color:${colour};font-weight:800">${r.n}</span></li>`).join('')
      }</ol>`
    : '<p style="margin:6px 0 0;color:#aaa;font-size:12px">— none yet —</p>';
  const bizHtml = `
    <h2>💷 Business — engagement &amp; intent</h2>
    <div class="stat-row">
      <div class="stat"><div class="num">${cs.clicks_24h || 0}</div><div class="lbl">Clicks 24h</div></div>
      <div class="stat"><div class="num" style="color:#888">${cs.clicks_7d || 0}</div><div class="lbl">Clicks 7d</div></div>
      <div class="stat"><div class="num" style="color:#e0004d">${ws.active || 0}</div><div class="lbl">Live Alerts</div></div>
      <div class="stat"><div class="num" style="color:#22c55e">+${ws.new_24h || 0}</div><div class="lbl">New Alerts 24h</div></div>
    </div>
    <p style="font-size:12px;color:#888;margin:0 0 16px">
      Last 24h intent split: <strong style="color:#0a1628">${cs.book_24h || 0}</strong> book · <strong style="color:#0a1628">${cs.fares_24h || 0}</strong> browse-fares.
    </p>
    <div style="display:flex;gap:20px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="font-size:12px;font-weight:800;color:#0a1628;text-transform:uppercase;letter-spacing:.3px">🔥 Top clicked (7d)</div>
        ${destList(topClickedDests, '#e0004d')}
      </div>
      <div style="flex:1;min-width:200px">
        <div style="font-size:12px;font-weight:800;color:#0a1628;text-transform:uppercase;letter-spacing:.3px">🔔 Most-wanted alerts</div>
        ${destList(topWatchedDests, '#0a1628')}
      </div>
    </div>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:0}
  .wrap{max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .header{background:linear-gradient(135deg,#0a1628,#1a2e4a);padding:28px 32px;color:#fff}
  .header h1{margin:0 0 4px;font-size:22px;font-weight:800}
  .header p{margin:0;color:rgba(255,255,255,.6);font-size:13px}
  .body{padding:24px 32px}
  h2{font-size:15px;font-weight:800;color:#0a1628;margin:24px 0 10px;border-left:3px solid #ffd200;padding-left:10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  .stat-row{display:flex;gap:16px;margin-bottom:20px}
  .stat{background:#f8fafc;border-radius:10px;padding:14px 18px;flex:1;text-align:center}
  .stat .num{font-size:26px;font-weight:900;color:#0a1628}
  .stat .lbl{font-size:11px;color:#888;font-weight:600;text-transform:uppercase;margin-top:2px}
  .footer{background:#f8fafc;padding:16px 32px;font-size:11px;color:#aaa;text-align:center}
  .btn{display:inline-block;background:#ffd200;color:#0a1628;font-weight:800;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <h1>✈ Mr Cheap Flights — Daily Digest</h1>
    <p>${today}</p>
  </div>
  <div class="body">
    ${scrapeHtml}
    ${opsHtml}

    <div class="stat-row">
      <div class="stat"><div class="num">${stats.total || 0}</div><div class="lbl">Total Members</div></div>
      <div class="stat"><div class="num" style="color:#e0004d">${stats.premium || 0}</div><div class="lbl">Premium</div></div>
      <div class="stat"><div class="num" style="color:#22c55e">+${stats.new_7d || 0}</div><div class="lbl">New (7d)</div></div>
      <div class="stat"><div class="num" style="color:#f59e0b">${pendingDeals.results.length}</div><div class="lbl">Pending Deals</div></div>
    </div>

    ${bizHtml}

    <h2>🔍 Deals Pending Review (${pendingDeals.results.length})</h2>
    <table>
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Route</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Price</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">AI Score</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Source</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Region</th>
      </tr></thead>
      <tbody>${pendingHtml}</tbody>
    </table>
    <p style="margin:8px 0 0"><a class="btn" href="https://mrcheapflights.ie/pipeline.html">Review in Pipeline →</a></p>

    <h2>⏳ Deals Expiring This Week</h2>
    <table>
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Route</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Price</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Expires</th>
      </tr></thead>
      <tbody>${expiringHtml}</tbody>
    </table>

    <h2>🆕 New Sign-ups (last 24h)</h2>
    <ul style="font-size:13px;padding-left:18px;margin:0">${newSubsHtml}</ul>

    <h2>⭐ New Premium Conversions (last 24h)</h2>
    <ul style="font-size:13px;padding-left:18px;margin:0">${newPremHtml}</ul>
  </div>
  <div class="footer">Mr Cheap Flights · <a href="https://mrcheapflights.ie" style="color:#888">mrcheapflights.ie</a> · <a href="https://mrcheapflights.co.uk" style="color:#888">mrcheapflights.co.uk</a></div>
</div>
</body></html>`;

  const plainText = `Mr Cheap Flights — Daily Digest (${today})

Members: ${stats.total} total · ${stats.premium} premium · +${stats.new_7d} new (7d)
Pending deals: ${pendingDeals.results.length}
Expiring this week: ${expiringDeals.results.length}

Open https://mrcheapflights.ie/pipeline.html to review pending deals.`;

  const to = context.env.DIGEST_TO_EMAIL || 'mrluciansnow@gmail.com';
  const result = await sendEmail(context.env, {
    to,
    subject: opsFailed
      ? `🚨 MCF Daily Digest — ${opsFailed} automation failure(s) · ${pendingDeals.results.length} pending`
      : `✈ MCF Daily Digest — ${pendingDeals.results.length} pending · ${stats.premium} premium`,
    html,
    text: plainText,
  });

  return Response.json({ ok: true, email: result, stats, pending: pendingDeals.results.length });
}
