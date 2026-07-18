// DELETE /api/admin/scraped-deals/:id — hard-delete a scraped row.
//
// Approve/reject live in [id]/[action].js (POST /:id/approve|reject — the
// paths the pipeline UI actually calls). The PATCH {action} handler that used
// to live here was a dead second-generation API shape nothing invoked; it also
// dropped dest_type/ai_copy on approve, so it was quietly worse than the real
// one. One canonical implementation now.

import { requireAdmin } from '../../../_lib/auth.js';

export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const id = parseInt(context.params.id);
  if (!id || id < 1) return new Response('Bad request', { status: 400 });

  await context.env.DB.prepare('DELETE FROM scraped_deals WHERE id=?').bind(id).run();
  return new Response(null, { status: 204 });
}
