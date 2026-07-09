// Shared image generation core — used by the pipeline's on-demand endpoint
// (api/admin/generate-image) and the daily backfill cron
// (api/cron/generate-images). Workers AI flux-1-schnell → base64 in the D1
// `images` table → served by /images/* (see migration 0010 for the R2 note).

// Pipeline style names → visual prompt fragments. Flux renders text badly,
// so every prompt forbids lettering; price/route overlays stay in HTML/CSS.
export const STYLE_PROMPTS = {
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

// Backfill default per destination type when no style was hand-picked.
const TYPE_DEFAULT_STYLE = {
  sun: 'Golden hour sunset',
  city: 'Neon cityscape',
  longhaul: 'Epic skyline night',
  wintersun: 'Golden paradise',
};

export function styleForDeal(deal, styleName) {
  return STYLE_PROMPTS[styleName]
    || STYLE_PROMPTS[TYPE_DEFAULT_STYLE[deal.dest_type]]
    || 'vibrant travel photography, inviting light, wanderlust mood';
}

/**
 * Generate a hero image for a deal and store it. Returns { key, url,
 * content_type } or throws with a descriptive message.
 */
export async function generateDealImage(env, deal, styleName) {
  if (!env.AI) throw new Error('AI binding not available on this deployment');

  const dest = (String(deal.route).split(/→|->/)[1] || deal.route).trim();
  const prompt = `${styleForDeal(deal, styleName)}, destination: ${dest}, travel deal hero image, ` +
    `high quality, no text, no words, no letters, no watermark`;

  const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 6 });
  const b64 = result?.image;
  if (!b64 || typeof b64 !== 'string') throw new Error('model returned no image');

  // Sniff content type from decoded magic bytes; store base64 TEXT itself —
  // D1 BLOB binds round-trip inconsistently across local/prod engines.
  const head = Uint8Array.from(atob(b64.slice(0, 8)), (c) => c.charCodeAt(0));
  const contentType = head[0] === 0x89 && head[1] === 0x50 ? 'image/png' : 'image/jpeg';
  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `deals/${deal.id}-${Date.now()}.${ext}`;

  await env.DB.prepare(
    'INSERT INTO images (key, content_type, bytes) VALUES (?, ?, ?)'
  ).bind(key, contentType, b64).run();

  // Keep at most the 3 newest images per deal.
  await env.DB.prepare(
    `DELETE FROM images WHERE key LIKE ? AND key NOT IN (
       SELECT key FROM images WHERE key LIKE ? ORDER BY created_at DESC LIMIT 3)`
  ).bind(`deals/${deal.id}-%`, `deals/${deal.id}-%`).run();

  return { key, url: `/images/${key}`, content_type: contentType };
}
