// GET /api/admin/deal-origins?dealId=N — per-city prices for one deal.
// Admin-only view of deal_origins, used by the pipeline to build a multi-city
// carousel (one slide per departure city). Unlike the public /api/deals path
// there's no tier gating here — this is the operator's own console.

import { requireAdmin } from '../../_lib/auth.js';
import { originsForDeal } from '../../_lib/multicity.js';

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(new URL(context.request.url).searchParams.get('dealId'));
  if (!id || id < 1) return Response.json({ error: 'dealId required' }, { status: 400 });

  const deal = await context.env.DB.prepare(
    'SELECT id, route, price, region FROM deals WHERE id=?'
  ).bind(id).first();
  if (!deal) return Response.json({ error: 'deal not found' }, { status: 404 });

  const origins = await originsForDeal(context.env, id, deal.price);
  return Response.json({ deal, origins }, { headers: { 'Cache-Control': 'no-store' } });
}
