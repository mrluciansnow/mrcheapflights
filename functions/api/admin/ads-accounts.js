// GET /api/admin/ads-accounts — connection config per platform (non-secret ids)
// PUT /api/admin/ads-accounts — upsert { platform, account_id, page_id, pixel_id }
//
// Only the addressing identifiers live here (ad-account / advertiser id, Page,
// pixel). The API TOKENS are env secrets (META_ACCESS_TOKEN /
// TIKTOK_ACCESS_TOKEN) set via `wrangler pages secret put` — never entered
// through this form and never stored in D1.

import { requireAdmin } from '../../_lib/auth.js';

const PLATFORMS = new Set(['meta', 'tiktok']);

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });
  let rows = [];
  try {
    const r = await context.env.DB.prepare('SELECT platform, account_id, page_id, pixel_id, status, updated_at FROM ad_accounts').all();
    rows = r.results || [];
  } catch { /* pre-migration */ }
  return Response.json(rows, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPut(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  const platform = String(body.platform || '').toLowerCase();
  if (!PLATFORMS.has(platform)) return Response.json({ error: 'platform must be meta or tiktok' }, { status: 400 });

  const clean = (v, n) => (v ? String(v).trim().slice(0, n) : null);
  const accountId = clean(body.account_id, 64);
  const pageId = clean(body.page_id, 64);
  const pixelId = clean(body.pixel_id, 64);
  const status = accountId ? 'connected' : 'disconnected';

  await context.env.DB.prepare(
    `INSERT INTO ad_accounts (platform, account_id, page_id, pixel_id, status, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(platform) DO UPDATE SET
       account_id=excluded.account_id, page_id=excluded.page_id, pixel_id=excluded.pixel_id,
       status=excluded.status, updated_at=unixepoch()`
  ).bind(platform, accountId, pageId, pixelId, status).run();

  return Response.json({ ok: true, platform, status });
}
