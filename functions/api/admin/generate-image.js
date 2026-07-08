// POST /api/admin/generate-image — { dealId, style? }
// Generates a deal hero image with Workers AI (flux-1-schnell), stores the
// bytes in the D1 `images` table, and returns its serving path (/images/...).
// Admin session or Bearer CRON_SECRET.
//
// Storage note: D1-backed on purpose — R2 isn't enabled on this account yet
// (API code 10042). The serving route hides that choice; see migration 0010.

import { requireAdmin } from '../../_lib/auth.js';

// Pipeline style names → visual prompt fragments. Flux renders text badly,
// so every prompt forbids lettering; price/route overlays stay in HTML/CSS.
const STYLE_PROMPTS = {
  'Synthwave retro':       'synthwave retro travel poster, neon grid horizon, purple and pink dusk sky, silhouetted palm trees',
  'Neon beach party':      'neon-lit tropical beach at night, hot pink and teal glow on the waves, festive energy',
  'Golden hour sunset':    'golden hour over the coastline, warm orange sun flare, dreamy soft light',
  'Epic skyline night':    'cinematic city skyline at night from above, glittering lights, dramatic dark sky',
  'Luxury editorial':      'luxury editorial travel photograph, film grain, muted premium tones, elegant composition',
  'Pop art passport':      'bold pop-art illustration of a travel scene, thick outlines, saturated colour blocks',
  'Neon cityscape':        'rain-slicked city street after dark, purple and teal neon reflections',
  'Vintage travel poster': 'vintage mid-century travel poster illustration, flat colours, stylised landmarks',
  'Urban energy':          'street-level travel photography, motion blur crowds, vivid urban colour',
  'Golden paradise':       'idyllic warm beach, turquoise shallows, golden sand, gentle waves',
  'Volcano drama':         'dramatic volcanic island landscape, dark basalt, red-lit sky, ocean spray',
  'Fire & ocean':          'contrast of warm sunset fire tones against deep cool blue ocean, aerial view',
};

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
  if (!context.env.AI) {
    return Response.json({ error: 'AI binding not available on this deployment' }, { status: 501 });
  }

  let body;
  try { body = await context.request.json(); } catch { body = null; }
  const dealId = parseInt(body?.dealId);
  if (!dealId || dealId < 1) return Response.json({ error: 'dealId required' }, { status: 400 });

  const deal = await context.env.DB.prepare(
    'SELECT id, route, dest_type FROM deals WHERE id=?'
  ).bind(dealId).first();
  if (!deal) return Response.json({ error: 'Deal not found' }, { status: 404 });

  const dest = (String(deal.route).split(/→|->/)[1] || deal.route).trim();
  const styleFragment = STYLE_PROMPTS[body?.style] ||
    'vibrant travel photography, inviting light, wanderlust mood';
  const prompt = `${styleFragment}, destination: ${dest}, travel deal hero image, ` +
    `high quality, no text, no words, no letters, no watermark`;

  let result;
  try {
    result = await context.env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt,
      steps: 6,
    });
  } catch (err) {
    return Response.json({ error: `image generation failed: ${err.message}` }, { status: 502 });
  }

  const b64 = result?.image;
  if (!b64 || typeof b64 !== 'string') {
    return Response.json({ error: 'model returned no image' }, { status: 502 });
  }

  // Sniff content type from the decoded magic bytes, but store the base64
  // TEXT itself — D1 BLOB binds round-trip inconsistently across local/prod
  // engines (arrays come back stringified), base64 is deterministic everywhere.
  const head = Uint8Array.from(atob(b64.slice(0, 8)), (c) => c.charCodeAt(0));
  const contentType = head[0] === 0x89 && head[1] === 0x50 ? 'image/png' : 'image/jpeg';
  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `deals/${dealId}-${Date.now()}.${ext}`;

  await context.env.DB.prepare(
    'INSERT INTO images (key, content_type, bytes) VALUES (?, ?, ?)'
  ).bind(key, contentType, b64).run();

  // Keep at most the 3 newest images per deal — old ones are dead weight in D1.
  await context.env.DB.prepare(
    `DELETE FROM images WHERE key LIKE ? AND key NOT IN (
       SELECT key FROM images WHERE key LIKE ? ORDER BY created_at DESC LIMIT 3)`
  ).bind(`deals/${dealId}-%`, `deals/${dealId}-%`).run();

  return Response.json({ ok: true, url: `/images/${key}`, content_type: contentType });
}
