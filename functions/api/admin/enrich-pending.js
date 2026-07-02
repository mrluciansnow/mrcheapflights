// POST /api/admin/enrich-pending
// Calls Claude Haiku to score + classify all un-enriched pending scraped deals.
// Auth: admin session cookie OR Bearer <CRON_SECRET>.
// Setup: wrangler pages secret put ANTHROPIC_API_KEY --project-name mrcheap
//
// For each deal returns: confidence (0-100), dest_type, badge correction.
// Deals with confidence >= 80 are automatically promoted to deals table as drafts.

import { requireAdmin } from '../../_lib/auth.js';

const VALID_TYPES  = new Set(['sun', 'city', 'longhaul', 'wintersun']);
const VALID_BADGES = new Set(['🔥 Hot', '⚡ Flash', '✈ Long Haul', '⭐ Featured', '⚠️ Mistake Fare']);

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 90);
}

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

  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({
      enriched: 0,
      reason: 'ANTHROPIC_API_KEY not configured — set it via: wrangler pages secret put ANTHROPIC_API_KEY --project-name mrcheap',
    });
  }

  // Fetch up to 30 un-enriched pending deals
  const { results: pending } = await context.env.DB.prepare(
    `SELECT id, source_name, route, price, badge, region, raw_snippet, dates
     FROM scraped_deals WHERE status='pending' AND confidence IS NULL
     ORDER BY created_at DESC LIMIT 30`
  ).all();

  if (!pending.length) return Response.json({ enriched: 0, reason: 'nothing_to_enrich' });

  const dealList = pending.map(d => ({
    id: d.id,
    route: d.route,
    price: d.price,
    source: d.source_name,
    dates: d.dates || '',
    snippet: (d.raw_snippet || '').slice(0, 150),
  }));

  const prompt = `You are a flight deal analyst for MrCheapFlights.ie and MrCheapFlights.co.uk — Irish and UK departure airport deals.

For each flight deal, return a JSON array where every element has:
- "id": unchanged integer
- "confidence": 0-100 (100 = unmistakably a genuine cheap flight deal with a clear route and price; 0 = spam, non-flight, unclear, or irrelevant)
- "dest_type": one of "sun" (warm beach holiday), "city" (European city break), "longhaul" (>6h flight e.g. USA/Asia/Australia), "wintersun" (Canaries/warm winter beach)
- "badge": one of "🔥 Hot", "⚡ Flash", "✈ Long Haul", "⭐ Featured", "⚠️ Mistake Fare"

Confidence guide: ≥80 = excellent deal, clear route, credible price. 50-79 = plausible but uncertain. <50 = poor quality or off-topic.

Deals:
${JSON.stringify(dealList, null, 0)}

Reply with ONLY the JSON array. No explanation, no markdown, no other text.`;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 30000);
  let aiRes;
  try {
    aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(to);
    const reason = err.name === 'AbortError' ? 'timeout after 30s' : err.message;
    return Response.json({ enriched: 0, error: reason }, { status: 502 });
  }
  clearTimeout(to);

  if (!aiRes.ok) {
    const body = await aiRes.text().catch(() => '');
    return Response.json({ enriched: 0, error: `Anthropic ${aiRes.status}: ${body.slice(0, 200)}` }, { status: 502 });
  }

  const aiData = await aiRes.json().catch(() => null);
  if (!aiData) return Response.json({ enriched: 0, error: 'invalid response from AI' }, { status: 502 });

  const raw = aiData?.content?.[0]?.text || '';
  let scores;
  try {
    // Strip markdown code fences Haiku sometimes adds
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    scores = JSON.parse(cleaned);
    if (!Array.isArray(scores)) throw new Error('not array');
  } catch {
    return Response.json({ enriched: 0, error: 'AI returned unparseable JSON', raw: raw.slice(0, 300) }, { status: 502 });
  }

  // Write enrichment scores back to scraped_deals
  const stmts = [];
  let enriched = 0;
  for (const s of scores) {
    if (!s?.id) continue;
    const confidence = Math.max(0, Math.min(100, parseInt(s.confidence) || 0));
    const destType = VALID_TYPES.has(s.dest_type) ? s.dest_type : null;
    const badge    = VALID_BADGES.has(s.badge)    ? s.badge    : null;

    stmts.push(context.env.DB.prepare(
      `UPDATE scraped_deals
       SET confidence=?, dest_type=COALESCE(?,dest_type), badge=COALESCE(?,badge), updated_at=unixepoch()
       WHERE id=? AND status='pending'`
    ).bind(confidence, destType, badge, s.id));
    enriched++;
  }
  if (stmts.length) await context.env.DB.batch(stmts);

  // Auto-approve high-confidence deals (≥80) as draft deals
  const { results: highConf } = await context.env.DB.prepare(
    `SELECT id, source_url, flag, route, dates, price, badge, region, dest_type
     FROM scraped_deals WHERE status='pending' AND confidence >= 80`
  ).all();

  let autoApproved = 0;
  if (highConf?.length) {
    const aStmts = [];
    for (const row of highConf) {
      // SSRF guard: only promote deals with real https:// source URLs
      if (!row.source_url || !row.source_url.startsWith('https://')) continue;

      const slug = slugify(row.route) + '-' + String(row.price).replace(/[^0-9]/g, '');

      aStmts.push(context.env.DB.prepare(
        `INSERT INTO deals (flag, route, dates, price, badge, url, slug, region, status, dest_type)
         VALUES (?,?,?,?,?,?,?,?,'draft',?)
         ON CONFLICT(slug,region) DO UPDATE SET
           price=excluded.price, dates=excluded.dates, badge=excluded.badge, updated_at=unixepoch()`
      ).bind(row.flag || '✈️', row.route, row.dates || '', row.price, row.badge || '🔥 Hot',
             row.source_url, slug, row.region, row.dest_type || 'city'));

      aStmts.push(context.env.DB.prepare(
        'UPDATE scraped_deals SET status=?,updated_at=unixepoch() WHERE id=?'
      ).bind('approved', row.id));

      autoApproved++;
    }
    if (aStmts.length) await context.env.DB.batch(aStmts);
  }

  return Response.json({ enriched, auto_approved: autoApproved });
}
