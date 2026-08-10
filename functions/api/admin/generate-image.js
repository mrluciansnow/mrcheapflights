// POST /api/admin/generate-image — { dealId, style? }
// On-demand generation for the pipeline dashboard's Step 3. Generation core
// lives in _lib/imagegen.js (shared with the daily backfill cron).
// Admin session or Bearer CRON_SECRET.

import { requireAdmin } from '../../_lib/auth.js';
import { generateDealImage } from '../../_lib/imagegen.js';

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = context.env.CRON_SECRET;
    if (!secret || !provided || provided !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body;
  try { body = await context.request.json(); } catch { body = null; }
  const dealId = parseInt(body?.dealId);
  if (!dealId || dealId < 1) return Response.json({ error: 'dealId required' }, { status: 400 });

  const deal = await context.env.DB.prepare(
    'SELECT id, route, dest_type FROM deals WHERE id=?'
  ).bind(dealId).first();
  if (!deal) return Response.json({ error: 'Deal not found' }, { status: 404 });

  try {
    const img = await generateDealImage(context.env, deal, body?.style);
    return Response.json({ ok: true, url: img.url, content_type: img.content_type });
  } catch (err) {
    const status = /binding not available/.test(err.message) ? 501 : 502;
    return Response.json({ error: `image generation failed: ${err.message}` }, { status });
  }
}
