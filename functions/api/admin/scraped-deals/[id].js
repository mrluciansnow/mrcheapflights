import { requireAdmin } from '../../../_lib/auth.js';

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
  // IPv4 private ranges and loopback
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  // IPv6 loopback / link-local
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('[::1]') || h.startsWith('[fe80:')) return false;
  // Must have a real TLD (at least one dot)
  if (!h.includes('.') && !h.includes(':')) return false;
  return true;
}

// PATCH /api/admin/scraped-deals/:id  { action: "approve" | "reject" }
export async function onRequestPatch(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id || id < 1) return new Response('Bad request', { status: 400 });

  let body;
  try { body = await context.request.json(); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { action } = body;
  if (!['approve', 'reject'].includes(action)) return new Response('Bad action', { status: 400 });

  if (action === 'reject') {
    await context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('rejected', id).run();
    return new Response(null, { status: 204 });
  }

  const row = await context.env.DB.prepare('SELECT * FROM scraped_deals WHERE id=?').bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });

  // Validate required fields before promoting to live deals table.
  if (!row.route || !row.price || !row.region) {
    return new Response('Scraped deal missing required fields (route, price, region)', { status: 422 });
  }
  if (!['ie', 'uk'].includes(row.region)) {
    return new Response('Invalid region on scraped deal', { status: 422 });
  }

  // Validate the source URL — must be a real HTTPS URL, not a private/internal address.
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
    ).bind(row.flag || '✈️', row.route, row.dates || '', row.price, row.badge || '', dealUrl, slug, row.region),
    context.env.DB.prepare(
      'UPDATE scraped_deals SET status=?, updated_at=unixepoch() WHERE id=?'
    ).bind('approved', id),
  ]);

  return new Response(null, { status: 204 });
}

// DELETE /api/admin/scraped-deals/:id
export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id) return new Response('Bad request', { status: 400 });

  await context.env.DB.prepare('DELETE FROM scraped_deals WHERE id=?').bind(id).run();
  return new Response(null, { status: 204 });
}
