import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestPut(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { id } = context.params;
  let body;
  try { body = await context.request.json(); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { flag, route, dates, price, badge, url, expiry, slug, region, status, pipelineStyle, pipelineCopy, imageUrl } = body;
  if (!route || !price || !slug) {
    return new Response('route, price and slug are required', { status: 400 });
  }
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    return new Response('slug must be lowercase alphanumeric with hyphens (max 120 chars)', { status: 400 });
  }
  if (!['ie', 'uk'].includes(region || 'ie')) {
    return new Response('region must be ie or uk', { status: 400 });
  }
  if (url && url !== '#' && !/^https?:\/\/.+/.test(url)) {
    return new Response('url must be https://...', { status: 400 });
  }
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return new Response('expiry must be YYYY-MM-DD', { status: 400 });
  }

  // status/pipelineStyle/pipelineCopy are optional -- only touched when the
  // caller (e.g. the content pipeline's "Publish" step) explicitly sends
  // them, so a plain CMS edit never accidentally changes a deal's status.
  const setClauses = ['flag=?', 'route=?', 'dates=?', 'price=?', 'badge=?', 'url=?', 'expiry=?', 'slug=?', 'region=?', 'updated_at=unixepoch()'];
  const binds = [flag || '✈️', route, dates || '', price, badge || '🔥 Hot', url || '#', expiry || null, slug, region || 'ie'];
  if (status !== undefined) { setClauses.push('status=?'); binds.push(status); }
  if (pipelineStyle !== undefined) { setClauses.push('pipeline_style=?'); binds.push(pipelineStyle); }
  if (pipelineCopy !== undefined) { setClauses.push('pipeline_copy=?'); binds.push(pipelineCopy); }
  if (imageUrl !== undefined) {
    // Only our own serving route or an absolute https URL
    if (imageUrl !== null && !/^\/images\/[a-z0-9\-_./]+$/i.test(imageUrl) && !/^https:\/\/.+/.test(imageUrl)) {
      return new Response('imageUrl must be /images/... or https://...', { status: 400 });
    }
    setClauses.push('image_url=?'); binds.push(imageUrl);
  }
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
