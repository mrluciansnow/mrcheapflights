// GET /api/admin/social-status — read-only Buffer connection check.
// Lists the connected channels WITHOUT posting anything, so "is social
// actually wired up?" is answerable from the pipeline in one click.

import { requireAdmin } from '../../_lib/auth.js';
import { bufferChannels } from '../../_lib/publishers.js';

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const token = (context.env.BUFFER_ACCESS_TOKEN || '').trim();
  if (!token) return Response.json({ armed: false, reason: 'BUFFER_ACCESS_TOKEN not set' });

  const list = await bufferChannels(token);
  if (list.error) return Response.json({ armed: true, ok: false, error: list.error });

  return Response.json({
    armed: true,
    ok: true,
    channels: list.channels.map((c) => ({ service: c.service, name: c.name })),
  });
}
