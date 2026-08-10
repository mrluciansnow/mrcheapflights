// POST /api/admin/save-poster { dealId, dataUrl }
// Stores the canvas-composed 1080×1080 social poster (JPEG data URL from the
// pipeline's composer) into the images table and points deals.poster_url at
// it. Social publishing prefers poster_url over the raw flux photo.

import { requireAdmin } from '../../_lib/auth.js';

const MAX_BYTES = 1_500_000; // ~1.5MB decoded — a q0.85 1080² JPEG is ~250-500KB

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await context.request.json(); } catch { body = null; }
  const dealId = parseInt(body?.dealId);
  const dataUrl = String(body?.dataUrl || '');
  if (!dealId || dealId < 1) return Response.json({ error: 'dealId required' }, { status: 400 });

  const m = dataUrl.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return Response.json({ error: 'dataUrl must be a base64 image/jpeg or image/png data URL' }, { status: 400 });
  const [, ext, b64] = m;
  if (b64.length * 0.75 > MAX_BYTES) {
    return Response.json({ error: `poster too large (${Math.round(b64.length * 0.75 / 1024)}KB > ${MAX_BYTES / 1000}KB)` }, { status: 413 });
  }

  const deal = await context.env.DB.prepare('SELECT id FROM deals WHERE id=?').bind(dealId).first();
  if (!deal) return Response.json({ error: 'deal not found' }, { status: 404 });

  const key = `posters/${dealId}-${Date.now()}.${ext === 'png' ? 'png' : 'jpg'}`;
  await context.env.DB.batch([
    context.env.DB.prepare(
      'INSERT INTO images (key, content_type, bytes, created_at) VALUES (?, ?, ?, unixepoch())'
    ).bind(key, `image/${ext}`, b64),
    // Old posters for this deal become orphans; nightly cleanup can prune
    // them later — correctness first, the table is cheap.
    context.env.DB.prepare(
      'UPDATE deals SET poster_url=?, updated_at=unixepoch() WHERE id=?'
    ).bind(`/images/${key}`, dealId),
  ]);

  return Response.json({ ok: true, url: `/images/${key}` });
}
