// POST /api/admin/enrich-pending
// Calls Claude Haiku to score + classify all un-enriched pending scraped deals.
// Auth: admin session cookie OR Bearer <CRON_SECRET>.
// Setup: wrangler pages secret put ANTHROPIC_API_KEY --project-name mrcheap
//
// For each deal returns: confidence (0-100), dest_type, badge correction.
// Deals with confidence >= 80 are automatically promoted to deals table as drafts.

import { requireAdmin } from '../../_lib/auth.js';
import { logOp } from '../../_lib/oplog.js';
import { destSlugForText, getDestination } from '../../_lib/destinations.js';
import { deriveExpiry, captionMatchesDeal } from '../../_lib/scraper.js';

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
    await logOp(context.env, 'enrich', false, { error: 'ANTHROPIC_API_KEY not configured' });
    return Response.json({
      enriched: 0,
      reason: 'ANTHROPIC_API_KEY not configured — set it via: wrangler pages secret put ANTHROPIC_API_KEY --project-name mrcheap',
    });
  }

  // Batch size is a TIMEOUT budget, not a token budget. Three IG-length
  // captions per deal is ~600 output tokens; at 6 deals that generation ran
  // past cron-job.org's 30s ceiling and the job was killed — and because every
  // DB write happens after the AI call returns, a timeout lost the whole batch
  // and the queue never drained. 3 deals comfortably fits the window.
  //
  // ?batch=N overrides it (1-8) for a manual catch-up run from the pipeline,
  // where there's no 30s ceiling.
  const url = new URL(context.request.url);
  const batchParam = parseInt(url.searchParams.get('batch'));
  const BATCH = Number.isFinite(batchParam) ? Math.min(8, Math.max(1, batchParam)) : 3;
  const { results: pending } = await context.env.DB.prepare(
    `SELECT id, source_name, route, price, badge, region, raw_snippet, dates
     FROM scraped_deals WHERE status='pending' AND confidence IS NULL
     ORDER BY created_at DESC LIMIT ${BATCH}`
  ).all();

  if (!pending.length) {
    return Response.json({ enriched: 0, remaining: 0, reason: 'Queue already scored — nothing new to enrich. Scrape first if you expected fresh deals.' });
  }

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
- "copy": array of exactly 3 Instagram-ready captions. Each caption MUST follow this structure:
  Line 1: a scroll-stopping hook with the price (this is all users see before "…more")
  Blank line, then 2-3 short punchy paragraphs: the route, the price vs what it normally costs, the dates, why this destination slaps right now. Energetic Irish/UK voice, emojis welcome.
  Blank line, then the CTA: "🔗 Link in bio to grab it before it's gone ✈"
  Final line: 6-9 hashtags mixing big and niche, always including #MrCheapFlights and #CheapFlights plus destination-specific tags.
  Aim for 500-850 characters per caption. Vary the tone across the 3: 1=urgent FOMO, 2=cheeky/funny, 3=straight-value expert.

Confidence guide: ≥80 = excellent deal, clear route, credible price. 50-79 = plausible but uncertain. <50 = poor quality or off-topic.

Deals:
${JSON.stringify(dealList, null, 0)}

Reply with ONLY the JSON array. No explanation, no markdown, no other text.`;

  // 24s, deliberately INSIDE cron-job.org's 30s cutoff: aborting ourselves
  // returns a clean, logged error the digest can show, whereas being killed by
  // the scheduler leaves no trace beyond "Failed (timeout)" in their console.
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 24000);
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
        // Scaled to the batch (~900 tokens/deal covers 3 captions plus the
        // scoring fields) with headroom, rather than a flat 8192 that let the
        // model run long enough to blow the timeout.
        max_tokens: Math.min(8192, 1200 + BATCH * 900),
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(to);
    const reason = err.name === 'AbortError' ? 'timeout after 30s' : err.message;
    await logOp(context.env, 'enrich', false, { error: reason });
    return Response.json({ enriched: 0, error: reason }, { status: 502 });
  }
  clearTimeout(to);

  if (!aiRes.ok) {
    const body = await aiRes.text().catch(() => '');
    await logOp(context.env, 'enrich', false, { error: `Anthropic ${aiRes.status}: ${body.slice(0, 120)}` });
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

  // Write enrichment scores + AI captions back to scraped_deals
  const stmts = [];
  let enriched = 0;
  let captionsDropped = 0;   // captions that failed the price/destination check
  for (const s of scores) {
    if (!s?.id) continue;
    const confidence = Math.max(0, Math.min(100, parseInt(s.confidence) || 0));
    const destType = VALID_TYPES.has(s.dest_type) ? s.dest_type : null;
    const badge    = VALID_BADGES.has(s.badge)    ? s.badge    : null;
    // 3 caption variants → JSON string; discard malformed shapes.
    //
    // QUALITY GATE: captions were previously accepted on type and length alone,
    // so a hallucinated price or the wrong city could go straight to Instagram
    // under our own branding. Each caption must actually mention this deal's
    // price AND its destination; ones that don't are dropped. If none survive
    // the deal still promotes — just without AI copy, which is far safer than
    // publishing a caption that misquotes the fare.
    const src = pending.find((p) => p.id === s.id);
    if (Array.isArray(s.copy) && s.copy.length && s.copy.every((c) => typeof c === 'string')) {
      const kept = src ? s.copy.filter((c) => captionMatchesDeal(c, src.route, src.price)) : s.copy;
      if (kept.length !== s.copy.length) {
        captionsDropped += s.copy.length - kept.length;
      }
      s.copy = kept;
    }
    if (Array.isArray(s.copy) && s.copy.length && s.copy.every((c) => typeof c === 'string')) {
      // IG captions run 500-850 chars by design; 1100 leaves headroom without
      // letting a runaway response bloat the row (IG's own cap is 2200).
      aiCopy = JSON.stringify(s.copy.slice(0, 3).map((c) => c.slice(0, 1100)));
    }

    stmts.push(context.env.DB.prepare(
      `UPDATE scraped_deals
       SET confidence=?, dest_type=COALESCE(?,dest_type), badge=COALESCE(?,badge),
           ai_copy=COALESCE(?,ai_copy), updated_at=unixepoch()
       WHERE id=? AND status='pending'`
    ).bind(confidence, destType, badge, aiCopy, s.id));
    enriched++;
  }
  if (stmts.length) await context.env.DB.batch(stmts);

  // Auto-approve high-confidence deals (≥80) as drafts. With AUTO_PUBLISH=1,
  // deals at ≥90 confidence skip the dashboard entirely and go straight live.
  const autoPublish = context.env.AUTO_PUBLISH === '1';
  const { results: highConf } = await context.env.DB.prepare(
    `SELECT id, source_url, flag, route, dates, price, badge, region, dest_type, confidence, ai_copy
     FROM scraped_deals WHERE status='pending' AND confidence >= 80`
  ).all();

  let autoApproved = 0;
  let autoPublished = 0;
  const skipped = [];        // promotion-blocked deals, with the reason
  const blockedStmts = [];   // reason write-backs, flushed with the batch
  if (highConf?.length) {
    const aStmts = [];
    for (const row of highConf) {
      // SSRF guard: only promote deals with real https:// source URLs.
      // This used to `continue` silently, so a deal scoring 90 could sit
      // pending for ever with nothing anywhere explaining why — invisible to
      // the operator and re-queried on every single run. Now it's counted,
      // named, and written back as a reason on the row.
      if (!row.source_url || !row.source_url.startsWith('https://')) {
        skipped.push({ id: row.id, route: row.route, reason: 'no https source URL' });
        blockedStmts.push(context.env.DB.prepare(
          `UPDATE scraped_deals SET skip_reason='no https source URL', updated_at=unixepoch() WHERE id=?`
        ).bind(row.id));
        continue;
      }

      // Match on ROUTE+REGION, not slug. The slug used to embed the price, so
      // the same route at a new price minted a fresh slug and the
      // ON CONFLICT(slug,region) upsert could never fire — production ended up
      // with "London → Bangkok" listed twice at £407 and £426. Existing slugs
      // are left untouched so already-shared /deals/<slug> links keep working.
      const existing = await context.env.DB.prepare(
        'SELECT id, slug FROM deals WHERE route=? AND region=? ORDER BY updated_at DESC LIMIT 1'
      ).bind(row.route, row.region).first();
      const slug = existing?.slug || slugify(row.route);
      const goLive = autoPublish && row.confidence >= 90;
      const status = goLive ? 'live' : 'draft';

      // Registry flag beats the scraped one (feeds mislabel countries).
      const hub = destSlugForText(row.route) ? getDestination(destSlugForText(row.route)) : null;
      const flag = hub?.flag || row.flag || '✈️';

      aStmts.push(context.env.DB.prepare(
        `INSERT INTO deals (flag, route, dates, price, badge, url, slug, region, status, dest_type, ai_copy, expiry)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(slug,region) DO UPDATE SET
           price=excluded.price, dates=excluded.dates, badge=excluded.badge,
           ai_copy=COALESCE(excluded.ai_copy, deals.ai_copy),
           expiry=COALESCE(excluded.expiry, deals.expiry), updated_at=unixepoch()`
      ).bind(flag, row.route, row.dates || '', row.price, row.badge || '🔥 Hot',
             row.source_url, slug, row.region, status, row.dest_type || 'city', row.ai_copy || null,
             deriveExpiry(row.dates)));

      aStmts.push(context.env.DB.prepare(
        'UPDATE scraped_deals SET status=?,updated_at=unixepoch() WHERE id=?'
      ).bind('approved', row.id));

      autoApproved++;
      if (goLive) autoPublished++;
    }
    if (aStmts.length) await context.env.DB.batch(aStmts);
  }
  if (blockedStmts.length) {
    try { await context.env.DB.batch(blockedStmts); } catch { /* column may predate migration */ }
  }

  await logOp(context.env, 'enrich', true, { enriched, auto_approved: autoApproved, auto_published: autoPublished, blocked: skipped.length, blocked_detail: skipped.slice(0, 5), captions_dropped: captionsDropped });

  // How many un-scored deals are still queued — lets the UI drain in one click.
  const left = await context.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scraped_deals WHERE status='pending' AND confidence IS NULL`
  ).first();

  return Response.json({ enriched, auto_approved: autoApproved, auto_published: autoPublished, blocked: skipped, remaining: left?.n || 0 });
}
