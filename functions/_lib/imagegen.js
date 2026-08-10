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

// Destination → landmark/scene hints. Generic "destination: Rome" prompts
// produce anonymous coastlines; a landmark anchor makes the image unmistakably
// *that* place, which is what makes tiles and shares feel editorial.
const DEST_HINTS = {
  'lisbon': 'Alfama rooftops and the 25 de Abril bridge', 'porto': 'Ribeira riverfront and Dom Luís bridge',
  'faro': 'Algarve sea cliffs and golden beaches', 'barcelona': 'Sagrada Família skyline and Gothic quarter rooftops',
  'madrid': 'Gran Vía architecture at dusk', 'malaga': 'Andalusian old town and Mediterranean shore',
  'alicante': 'Santa Bárbara castle above the marina', 'palma': 'Palma cathedral over the bay', 'mallorca': 'Serra de Tramuntana coves',
  'ibiza': 'Dalt Vila old town above a turquoise cove', 'tenerife': 'Mount Teide above the clouds',
  'lanzarote': 'volcanic Timanfaya landscape', 'gran canaria': 'Maspalomas dunes at sunset',
  'rome': 'Colosseum and terracotta rooftops', 'milan': 'Duomo spires', 'venice': 'gondolas on the Grand Canal',
  'naples': 'Vesuvius across the bay', 'amsterdam': 'canal houses and bridges', 'paris': 'Eiffel Tower over Haussmann rooftops',
  'nice': 'Promenade des Anglais and azure water', 'berlin': 'Brandenburg Gate', 'munich': 'Marienplatz and Alps horizon',
  'prague': 'Charles Bridge and castle', 'budapest': 'Parliament on the Danube', 'krakow': 'Old Town square',
  'vienna': 'Schönbrunn and baroque skyline', 'athens': 'the Acropolis at golden hour', 'santorini': 'white and blue cliffside houses',
  'mykonos': 'windmills and whitewashed lanes', 'rhodes': 'medieval old town harbour', 'crete': 'Balos lagoon',
  'split': 'Diocletian palace waterfront', 'dubrovnik': 'walled old town above the Adriatic', 'malta': 'Valletta harbour bastions',
  'istanbul': 'Hagia Sophia and Bosphorus', 'marrakech': 'medina rooftops and Koutoubia minaret',
  'new york': 'Manhattan skyline and Brooklyn Bridge', 'boston': 'brownstones and harbour', 'miami': 'Ocean Drive art deco neon',
  'orlando': 'palm-lined lakes at dusk', 'los angeles': 'palm trees and Hollywood hills', 'san francisco': 'Golden Gate Bridge in fog',
  'chicago': 'the Loop skyline from the river', 'las vegas': 'the Strip glowing at night', 'toronto': 'CN Tower skyline',
  'vancouver': 'mountains meeting the harbour', 'dubai': 'Burj Khalifa above the marina', 'doha': 'West Bay skyline',
  'bangkok': 'temples and tuk-tuks at dusk', 'singapore': 'Marina Bay Sands and supertrees', 'tokyo': 'Shibuya neon and Mount Fuji horizon',
  'hong kong': 'Victoria Harbour skyline', 'bali': 'rice terraces and temple gates', 'phuket': 'longtail boats on limestone bays',
  'cape town': 'Table Mountain over the city', 'sydney': 'Opera House and Harbour Bridge', 'melbourne': 'laneway lights and trams',
  'cancun': 'Caribbean shoreline and Mayan ruins', 'reykjavik': 'Hallgrímskirkja and northern lights',
};

export function styleForDeal(deal, styleName) {
  return STYLE_PROMPTS[styleName]
    || STYLE_PROMPTS[TYPE_DEFAULT_STYLE[deal.dest_type]]
    || 'vibrant travel photography, inviting light, wanderlust mood';
}

export function destHint(dest) {
  const clean = String(dest || '').toLowerCase().trim();
  for (const key of Object.keys(DEST_HINTS)) {
    if (clean.includes(key)) return DEST_HINTS[key];
  }
  return null;
}

/**
 * Generate a hero image for a deal and store it. Returns { key, url,
 * content_type } or throws with a descriptive message.
 */
// Shared core: run flux, store the base64 in the images table under
// `<folder>/<id>-<ts>.<ext>`, prune to the newest N for that id, return url.
async function runAndStore(env, folder, id, prompt, keepNewest = 3) {
  if (!env.AI) throw new Error('AI binding not available on this deployment');

  const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 6 });
  const b64 = result?.image;
  if (!b64 || typeof b64 !== 'string') throw new Error('model returned no image');

  // Sniff content type from decoded magic bytes; store base64 TEXT itself —
  // D1 BLOB binds round-trip inconsistently across local/prod engines.
  const head = Uint8Array.from(atob(b64.slice(0, 8)), (c) => c.charCodeAt(0));
  const contentType = head[0] === 0x89 && head[1] === 0x50 ? 'image/png' : 'image/jpeg';
  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `${folder}/${id}-${Date.now()}.${ext}`;

  await env.DB.prepare(
    'INSERT INTO images (key, content_type, bytes) VALUES (?, ?, ?)'
  ).bind(key, contentType, b64).run();

  await env.DB.prepare(
    `DELETE FROM images WHERE key LIKE ? AND key NOT IN (
       SELECT key FROM images WHERE key LIKE ? ORDER BY created_at DESC LIMIT ?)`
  ).bind(`${folder}/${id}-%`, `${folder}/${id}-%`, keepNewest).run();

  return { key, url: `/images/${key}`, content_type: contentType };
}

export async function generateDealImage(env, deal, styleName) {
  const dest = (String(deal.route).split(/→|->/)[1] || deal.route).trim();
  const hint = destHint(dest);
  const prompt = `${styleForDeal(deal, styleName)}, ${hint ? `featuring ${hint}, ` : ''}destination: ${dest}, ` +
    `travel deal hero image, high quality, no text, no words, no letters, no watermark`;
  return runAndStore(env, 'deals', deal.id, prompt);
}

// Evergreen hero for a destination hub page. `dest` is a registry entry
// ({ slug, name, landmark, type }). Wider, editorial, landmark-anchored.
export async function generateDestinationImage(env, dest) {
  const style = STYLE_PROMPTS[TYPE_DEFAULT_STYLE?.[dest.type]] || 'vibrant editorial travel photography, inviting golden light';
  const prompt = `${style}, featuring ${dest.landmark}, ${dest.name} ${dest.country || ''}, ` +
    `wide cinematic travel hero, high quality, no text, no words, no letters, no watermark`;
  return runAndStore(env, 'dest', dest.slug, prompt, 2);
}
