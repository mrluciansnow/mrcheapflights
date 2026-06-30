import { requireAdmin } from '../../_lib/auth.js';
import { runScraper } from '../../_lib/scraper.js';
import { sendEmail } from '../../_lib/email.js';

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
  ] = await Promise.all([
    db.prepare(`SELECT id, source_name, route, price, badge, region, created_at
                FROM scraped_deals WHERE status='pending'
                ORDER BY created_at DESC LIMIT 20`).all(),
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
  ]);

  const today = new Date().toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const pendingHtml = pendingDeals.results.length
    ? pendingDeals.results.map(d => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${d.badge} ${d.route}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700;color:#e0004d">${d.price}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#666">${d.source_name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee"><span style="background:${d.region==='ie'?'#169b62':'#012169'};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">${d.region.toUpperCase()}</span></td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="padding:12px;color:#888;text-align:center">No pending deals</td></tr>`;

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

    <div class="stat-row">
      <div class="stat"><div class="num">${stats.total || 0}</div><div class="lbl">Total Members</div></div>
      <div class="stat"><div class="num" style="color:#e0004d">${stats.premium || 0}</div><div class="lbl">Premium</div></div>
      <div class="stat"><div class="num" style="color:#22c55e">+${stats.new_7d || 0}</div><div class="lbl">New (7d)</div></div>
      <div class="stat"><div class="num" style="color:#f59e0b">${pendingDeals.results.length}</div><div class="lbl">Pending Deals</div></div>
    </div>

    <h2>🔍 Deals Pending Review (${pendingDeals.results.length})</h2>
    <table>
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Route</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888">Price</th>
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
    subject: `✈ MCF Daily Digest — ${pendingDeals.results.length} pending · ${stats.premium} premium`,
    html,
    text: plainText,
  });

  return Response.json({ ok: true, email: result, stats, pending: pendingDeals.results.length });
}
