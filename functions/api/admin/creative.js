// POST /api/admin/creative { dealId }
// AI Creative Studio: given a live/draft deal, Claude Haiku writes a
// ready-to-shoot TikTok slideshow brief AND an Instagram Reel script — hook,
// beat-by-beat on-screen text + visual direction, audio vibe, caption,
// hashtags. Output is what you hand a creator or run as an ad.
//
// Auth: admin session. Needs ANTHROPIC_API_KEY.

import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });

  let body;
  try { body = await context.request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const dealId = parseInt(body?.dealId);
  if (!dealId || dealId < 1) return Response.json({ error: 'dealId required' }, { status: 400 });

  const deal = await context.env.DB.prepare(
    'SELECT route, price, was_price, dates, airline, badge, region FROM deals WHERE id=?'
  ).bind(dealId).first();
  if (!deal) return Response.json({ error: 'deal not found' }, { status: 404 });

  const dest = (String(deal.route).split(/→|->/)[1] || deal.route).trim();
  const cur = deal.region === 'uk' ? '£' : '€';
  const siteUrl = deal.region === 'uk' ? 'mrcheapflights.co.uk' : 'mrcheapflights.ie';

  const prompt = `You are a short-form social creative director for Mr Cheap Flights, a cheap-flights brand for ${deal.region === 'uk' ? 'UK' : 'Irish'} travellers. Write ad creative for THIS deal:

Route: ${deal.route}
Price: ${deal.price} return${deal.was_price ? ` (normally ${deal.was_price})` : ''}
Dates: ${deal.dates || 'flexible'}
Airline: ${deal.airline || 'various'}
Destination: ${dest}

Return ONLY a JSON object, no markdown, with this exact shape:
{
  "tiktok": {
    "hook": "the first on-screen line (must stop the scroll in <2s, mention the price)",
    "slides": [ { "text": "on-screen caption for this slide (short, punchy)", "visual": "what b-roll/shot to show" } ],
    "audio": "the kind of trending sound to use (vibe, not a specific copyrighted track)",
    "caption": "the post caption (1-2 lines + a CTA to sign up free at ${siteUrl})",
    "hashtags": ["6-10 mixed big+niche tags including #MrCheapFlights"]
  },
  "instagram": {
    "hook": "opening Reel line (scroll-stopper with the price)",
    "beats": [ { "text": "voiceover/on-screen line", "visual": "shot direction" } ],
    "caption": "Reel caption with a CTA to the link in bio",
    "hashtags": ["6-10 tags including #MrCheapFlights"]
  }
}
Rules: tiktok.slides = 5 to 6 items; instagram.beats = 4 to 5 items. Energetic, a little cheeky, ${deal.region === 'uk' ? 'British' : 'Irish'} voice. Reference ${dest} specifically. Prices in ${cur}. No fake urgency claims we can't back up. Plain text values, emojis welcome, no markdown inside strings.`;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 30000);
  let aiRes;
  try {
    aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(to);
    return Response.json({ error: err.name === 'AbortError' ? 'timeout' : err.message }, { status: 502 });
  }
  clearTimeout(to);

  if (!aiRes.ok) {
    const t = await aiRes.text().catch(() => '');
    return Response.json({ error: `Anthropic ${aiRes.status}: ${t.slice(0, 160)}` }, { status: 502 });
  }
  const data = await aiRes.json().catch(() => null);
  const raw = data?.content?.[0]?.text || '';
  let creative;
  try {
    creative = JSON.parse(raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim());
  } catch {
    return Response.json({ error: 'AI returned unparseable JSON', raw: raw.slice(0, 300) }, { status: 502 });
  }

  return Response.json({ ok: true, dealId, route: deal.route, creative }, { headers: { 'Cache-Control': 'no-store' } });
}
