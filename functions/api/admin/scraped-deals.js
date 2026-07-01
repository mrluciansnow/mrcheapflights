import { requireAdmin } from '../../_lib/auth.js';

// Admin CRUD for scraped deals.
// GET  /api/admin/scraped-deals?status=pending  — list
// POST /api/admin/scraped-deals/:id/approve     — copy to deals table
// POST /api/admin/scraped-deals/:id/reject      — mark rejected
// DELETE /api/admin/scraped-deals/:id           — hard-delete

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 100);
}

// Block SSRF: reject URLs pointing to private/loopback addresses.
function isSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost') return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('[::1]') || h.startsWith('[fe80:')) return false;
  if (!h.includes('.') && !h.includes(':')) return false;
  return true;
}

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const url = new URL(context.request.url);
  const status = url.searchParams.get('status') || 'pending';
  const region = url.searchParams.get('region');

  let sql = `SELECT id, source_name, source_url, flag, route, dates, price, badge, region, status, raw_snippet, created_at, updated_at
             FROM scraped_deals WHERE status = ?`;
  const params = [status];
  if (region && ['ie', 'uk'].includes(region)) { sql += ' AND region = ?'; params.push(region); }
  sql += ' ORDER BY created_at DESC LIMIT 100';

  const { results } = await context.env.DB.prepare(sql).bind(...params).all();
  return Response.json(results);
}

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const url = new URL(context.request.url);
  const parts = url.pathname.split('/');
  const id = parseInt(parts[parts.length - 2]);
  const action = parts[parts.length - 1]; // 'approve' or 'reject'

  if (!id || id < 1 || !['approve', 'reject'].includes(action)) {
    return new Response('Bad request', { status: 400 });
  }

  if (action === 'reject') {
    await context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('rejected', id).run();
    return new Response(null, { status: 204 });
  }

  // approve — validate and copy to `deals`
  const row = await context.env.DB.prepare(
    'SELECT id, source_name, source_url, flag, route, dates, price, badge, region FROM scraped_deals WHERE id=?'
  ).bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });

  if (!row.route || !row.price || !row.region) {
    return new Response('Scraped deal missing required fields (route, price, region)', { status: 422 });
  }
  if (!['ie', 'uk'].includes(row.region)) {
    return new Response('Invalid region on scraped deal', { status: 422 });
  }
  const dealUrl = row.source_url || '';
  if (!dealUrl || !isSafeUrl(dealUrl)) {
    return new Response('Scraped deal has missing or invalid source URL — edit before approving', { status: 422 });
  }

  const slug = slugify(row.route) + '-' + String(row.price).replace(/[^0-9]/g, '');

  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO deals (flag, route, dates, price, badge, url, slug, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, region) DO UPDATE SET
         price=excluded.price, dates=excluded.dates, updated_at=unixepoch()`
    ).bind(row.flag || '✈️', row.route, row.dates || '', row.price, row.badge || '🔥 Hot', dealUrl, slug, row.region),
    context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('approved', id),
  ]);

  return new Response(null, { status: 204 });
}

export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const url = new URL(context.request.url);
  const id = parseInt(url.pathname.split('/').pop());
  if (!id || id < 1) return new Response('Bad request', { status: 400 });

  await context.env.DB.prepare('DELETE FROM scraped_deals WHERE id=?').bind(id).run();
  return new Response(null, { status: 204 });
}
