// POST/GET /api/cron/generate-images — daily image backfill.
// Finds live deals with no hero image and generates one each (style picked
// by dest_type), so auto-published deals and pre-pipeline deals get imagery
// with zero human touch. The landing pages, tiles, modal, social posts and
// email blocks all pick the image up automatically via deals.image_url.
//
// Capped at 2 generations per run (~10s each) to stay inside cron-job.org's
// 30s request timeout — the backlog drains over a few mornings.
// cron-job.org schedule: 09:20 Europe/London, Bearer CRON_SECRET.

import { requireAdmin } from '../../_lib/auth.js';
import { generateDealImage } from '../../_lib/imagegen.js';
import { logOp } from '../../_lib/oplog.js';

const MAX_PER_RUN = 2;

async function handle(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = context.env.CRON_SECRET;
    if (!secret || !provided || provided !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const { results: deals } = await context.env.DB.prepare(
    `SELECT id, route, dest_type FROM deals
     WHERE status='live' AND (image_url IS NULL OR image_url = '')
       AND (expiry IS NULL OR date(expiry) >= date('now'))
     ORDER BY created_at DESC LIMIT ?`
  ).bind(MAX_PER_RUN).all();

  if (!deals || deals.length === 0) {
    await logOp(context.env, 'images', true, { generated: 0, reason: 'all live deals have images' });
    return Response.json({ ok: true, generated: 0, reason: 'all live deals have images' });
  }

  const results = [];
  for (const deal of deals) {
    try {
      const img = await generateDealImage(context.env, deal);
      await context.env.DB.prepare(
        'UPDATE deals SET image_url=?, updated_at=unixepoch() WHERE id=?'
      ).bind(img.url, deal.id).run();
      results.push({ id: deal.id, route: deal.route, url: img.url });
    } catch (err) {
      results.push({ id: deal.id, route: deal.route, error: err.message });
    }
  }

  const generated = results.filter((r) => r.url).length;
  await logOp(context.env, 'images', results.every((r) => !r.error), { generated, results });
  return Response.json({ ok: true, generated, results });
}

export async function onRequestPost(context) { return handle(context); }
export async function onRequestGet(context) { return handle(context); }
