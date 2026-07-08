// GET /images/* — serves generated deal images from the D1 `images` table.
// Aggressive edge caching means D1 is only hit on cold PoPs; when R2 gets
// enabled this route swaps to env.IMAGES.get(key) with no URL changes.
export async function onRequestGet(context) {
  const parts = context.params.path;
  const key = Array.isArray(parts) ? parts.join('/') : String(parts || '');
  if (!key || key.length > 200 || !/^[a-z0-9\-_./]+$/i.test(key) || key.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const row = await context.env.DB.prepare(
    'SELECT content_type, bytes FROM images WHERE key=?'
  ).bind(key).first();

  if (!row) return new Response('Not found', { status: 404 });

  // bytes column holds base64 text (see generate-image.js) — decode to binary
  let bin;
  try {
    bin = Uint8Array.from(atob(row.bytes), (c) => c.charCodeAt(0));
  } catch {
    return new Response('Corrupt image', { status: 500 });
  }

  return new Response(bin, {
    headers: {
      'Content-Type': row.content_type || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
