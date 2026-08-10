// POST /api/admin/generate-destination-content  — { slug? }
// Generates evergreen SEO guide content + a hero image for destination hub
// pages, caching both in the destination_content table. Idempotent: skips
// destinations that already have content unless a specific slug is passed.
// Admin session OR Bearer CRON_SECRET. Capped per run to fit cron timeouts.
//
// This is the content engine behind /flights-to/:slug — the programmatic-SEO
// growth layer. Run daily (a few destinations per run) until the registry is
// fully populated, then it no-ops.

import { requireAdmin } from '../../_lib/auth.js';
import { getDestination, allDestinations } from '../../_lib/destinations.js';
import { generateDestinationImage } from '../../_lib/imagegen.js';
import { logOp } from '../../_lib/oplog.js';

const MAX_PER_RUN = 3;

function buildPrompt(d) {
  return `You are a travel editor for MrCheapFlights.ie / .co.uk, writing an evergreen guide page for people in Ireland and the UK looking for cheap flights to ${d.name}, ${d.country}.

Write factual, genuinely useful, upbeat copy. Reply with ONLY a JSON object, no markdown, no preamble, matching exactly:
{
  "intro": "2-3 sentence intro to flying to ${d.name} from Ireland/UK — the vibe of the place and why it's a great-value trip. Mention ${d.landmark}.",
  "best_time": "One sentence: the best months to visit and to find cheap fares.",
  "airlines": "One sentence naming the airlines that typically fly to ${d.name} from Dublin and/or UK airports (e.g. Ryanair, Aer Lingus, easyJet, Jet2, TUI, or long-haul carriers).",
  "price_from": "Typical cheapest return fare as a short range, both currencies, e.g. 'from €39 / £35 return'. Be realistic for this route length.",
  "highlights": ["4 short bullet strings — top things to do or see in ${d.name}"],
  "faq": [
    {"q":"How long is the flight to ${d.name}?","a":"Realistic flight time from Dublin/London, one sentence."},
    {"q":"When is the cheapest time to fly to ${d.name}?","a":"One sentence."},
    {"q":"Which airport should I fly into for ${d.name}?","a":"One sentence naming the main airport."},
    {"q":"Do I need a visa to visit ${d.name}?","a":"One sentence for Irish/UK passport holders."}
  ]
}`;
}

async function generateForDestination(env, d) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 25000);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{ role: 'user', content: buildPrompt(d) }],
      }),
      signal: controller.signal,
    });
  } finally { clearTimeout(to); }

  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const raw = (data?.content?.[0]?.text || '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  let guide;
  try { guide = JSON.parse(raw); } catch { throw new Error('AI returned unparseable JSON'); }
  if (!guide.intro || !Array.isArray(guide.faq)) throw new Error('AI guide missing required fields');

  // Hero image (best-effort — content still ships without it)
  let imageUrl = null;
  try { imageUrl = (await generateDestinationImage(env, d)).url; } catch { /* image optional */ }

  const intro = String(guide.intro).slice(0, 600);
  const guideJson = JSON.stringify({
    best_time: String(guide.best_time || '').slice(0, 300),
    airlines: String(guide.airlines || '').slice(0, 300),
    price_from: String(guide.price_from || '').slice(0, 120),
    highlights: (Array.isArray(guide.highlights) ? guide.highlights : []).slice(0, 6).map((h) => String(h).slice(0, 160)),
    faq: (Array.isArray(guide.faq) ? guide.faq : []).slice(0, 6).map((f) => ({
      q: String(f.q || '').slice(0, 200), a: String(f.a || '').slice(0, 500),
    })),
  });

  await env.DB.prepare(
    `INSERT INTO destination_content (slug, intro, guide_json, image_url, updated_at)
     VALUES (?, ?, ?, ?, unixepoch())
     ON CONFLICT(slug) DO UPDATE SET
       intro=excluded.intro, guide_json=excluded.guide_json,
       image_url=COALESCE(excluded.image_url, destination_content.image_url), updated_at=unixepoch()`
  ).bind(d.slug, intro, guideJson, imageUrl).run();

  return { slug: d.slug, image: !!imageUrl };
}

async function handle(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!context.env.CRON_SECRET || provided !== context.env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body = null;
  try { body = await context.request.json(); } catch { /* optional */ }

  // Targeted regenerate for one slug, or fill the gaps.
  let targets;
  if (body?.slug) {
    const d = getDestination(body.slug);
    if (!d) return Response.json({ error: 'unknown destination slug' }, { status: 400 });
    targets = [d];
  } else {
    const { results } = await context.env.DB.prepare(
      'SELECT slug FROM destination_content WHERE guide_json IS NOT NULL'
    ).all();
    const done = new Set((results || []).map((r) => r.slug));
    targets = allDestinations().filter((d) => !done.has(d.slug)).slice(0, MAX_PER_RUN);
  }

  if (!targets.length) {
    return Response.json({ ok: true, generated: 0, reason: 'all destinations have content' });
  }

  const results = [];
  for (const d of targets) {
    try { results.push(await generateForDestination(context.env, d)); }
    catch (e) { results.push({ slug: d.slug, error: e.message }); }
  }

  const generated = results.filter((r) => !r.error).length;
  await logOp(context.env, 'dest_content', results.every((r) => !r.error), { generated, results });
  return Response.json({ ok: true, generated, results });
}

export async function onRequestPost(context) { return handle(context); }
export async function onRequestGet(context) { return handle(context); }
