import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestPut(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { id } = context.params;
  const body = await context.request.json();
  const { flag, route, dates, price, badge, url, expiry, slug, region, status, pipelineStyle, pipelineCopy } = body;
  if (!route || !price || !slug) {
    return new Response('route, price and slug are required', { status: 400 });
  }

  // status/pipelineStyle/pipelineCopy are optional -- only touched when the
  // caller (e.g. the content pipeline's "Publish" step) explicitly sends
  // them, so a plain CMS edit never accidentally changes a deal's status.
  const setClauses = ['flag=?', 'route=?', 'dates=?', 'price=?', 'badge=?', 'url=?', 'expiry=?', 'slug=?', 'region=?', 'updated_at=unixepoch()'];
  const binds = [flag || '✈️', route, dates || '', price, badge || '🔥 Hot', url || '#', expiry || null, slug, region || 'ie'];
  if (status !== undefined) { setClauses.push('status=?'); binds.push(status); }
  if (pipelineStyle !== undefined) { setClauses.push('pipeline_style=?'); binds.push(pipelineStyle); }
  if (pipelineCopy !== undefined) { setClauses.push('pipeline_copy=?'); binds.push(pipelineCopy); }
  binds.push(id);

  await context.env.DB.prepare(`UPDATE deals SET ${setClauses.join(', ')} WHERE id=?`).bind(...binds).run();

  return new Response(null, { status: 204 });
}

export async function onRequestDelete(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  await context.env.DB.prepare('DELETE FROM deals WHERE id = ?').bind(context.params.id).run();
  return new Response(null, { status: 204 });
}
