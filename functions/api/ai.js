// Proxy for the Mr Cheap AI chat widget.
// Keeps the Anthropic API key server-side instead of exposing it in the browser.
// Rate-limited to 20 req/min per IP (graceful-degrades if DB not bound).

const ALLOWED_ORIGINS = new Set([
  'https://mrcheapflights.ie',
  'https://mrcheapflights.co.uk',
  'https://mrcheap.flights',
  'https://www.mrcheap.flights',
]);

function getAllowedOrigin(origin) {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  // Allow any *.mrcheap.pages.dev preview URL
  if (/^https:\/\/[a-z0-9-]+\.mrcheap\.pages\.dev$/.test(origin)) return origin;
  return null;
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get('Origin') || '';
  const allowedOrigin = getAllowedOrigin(origin);
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin || 'https://mrcheapflights.ie',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };

  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'AI not configured' }, { status: 503, headers: corsHeaders });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response('Bad request', { status: 400, headers: corsHeaders });
  }

  // Only allow the model we want — prevents abuse of the proxy to call arbitrary models.
  const allowedModels = ['claude-haiku-4-5-20251001', 'claude-haiku-4-5', 'claude-sonnet-4-6'];
  const model = allowedModels.includes(body.model) ? body.model : 'claude-haiku-4-5-20251001';

  // Basic rate-limit: 20 req/min per IP stored in D1 (degrades gracefully if table missing).
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const minute = Math.floor(Date.now() / 60000);
    const key = `ai_rl:${ip}:${minute}`;
    const row = await context.env.DB.prepare(
      `INSERT INTO kv_rate_limit (key, count) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`
    ).bind(key).first().catch(() => null);
    if (row && row.count > 20) {
      return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: corsHeaders });
    }
  } catch { /* rate limit table not yet created — allow through */ }

  const payload = {
    model,
    max_tokens: Math.min(body.max_tokens || 400, 600),
    messages: (body.messages || []).slice(-12), // cap history
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status, headers: corsHeaders });
  } catch (err) {
    return Response.json({ error: 'AI request failed' }, { status: 502, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
