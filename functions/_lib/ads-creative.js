// AI ad-copy generation — the "marketing design" layer. Given a campaign (and
// optionally a specific deal to feature), Claude Haiku writes a few
// platform-appropriate ad-copy variants: primary text, headline, link
// description, CTA and a one-line visual concept. The operator A/B tests these
// or pastes them straight into Ads Manager.
//
// Mirrors the existing Creative Studio (creative.js) call/parse pattern.
// Needs ANTHROPIC_API_KEY; returns { ok, variants } or { ok:false, error, status }.

const META_CTAS = ['Learn More', 'Sign Up', 'Get Offer', 'Subscribe', 'See Deals'];
const TT_CTAS = ['Learn More', 'Sign Up', 'Shop Now'];

export async function generateAdCreative(env, campaign, { deal = null, variants = 3 } = {}) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY not configured', status: 503 };

  const region = campaign.region === 'uk' ? 'UK' : 'Irish';
  const cur = campaign.region === 'uk' ? '£' : '€';
  const isMeta = campaign.platform === 'meta';
  const ctas = isMeta ? META_CTAS : TT_CTAS;
  const dealLine = deal
    ? `Feature this specific deal: ${deal.route} for ${deal.price} return${deal.dates ? ` (${deal.dates})` : ''}.`
    : `No single deal — sell the promise: "we find ${region} travellers genuinely cheap flights, fares independently checked daily."`;

  const prompt = `You are a direct-response paid-social copywriter for Mr Cheap Flights, a cheap-flights brand for ${region} travellers. Write ${variants} distinct ${isMeta ? 'Meta (Facebook/Instagram)' : 'TikTok'} ad-copy variants for this campaign.

Campaign: ${campaign.name}
Objective: ${campaign.objective}
Landing page: ${campaign.landing_url} (free email signup for daily flight deals)
${dealLine}

Return ONLY a JSON array of ${variants} objects, no markdown, each exactly:
{
  "primary_text": ${isMeta ? '"main ad text, <=125 chars, scroll-stopping, lead with a price or bold hook"' : '"TikTok caption, punchy, <=100 chars, lead with a price/hook"'},
  "headline": ${isMeta ? '"headline, <=40 chars"' : '"on-screen opening hook, <=40 chars"'},
  "description": ${isMeta ? '"link description, <=30 chars"' : '""'},
  "cta": "one of: ${ctas.join(', ')}",
  "concept": "one line of visual/angle direction for the creative"
}
Rules: prices in ${cur}. Energetic, a little cheeky, ${region} voice. Make each variant a DIFFERENT angle (e.g. FOMO, curiosity, destination-lust, price-shock). No fake urgency or claims we can't back up. Plain text values, emojis ok, no markdown inside strings.`;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1600, messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(to);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message, status: 502 };
  }
  clearTimeout(to);

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `Anthropic ${res.status}: ${t.slice(0, 160)}`, status: 502 };
  }
  const data = await res.json().catch(() => null);
  const raw = data?.content?.[0]?.text || '';
  let arr;
  try {
    arr = JSON.parse(raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim());
  } catch {
    return { ok: false, error: 'AI returned unparseable JSON', raw: raw.slice(0, 300), status: 502 };
  }
  if (!Array.isArray(arr)) arr = [arr];

  const clean = arr.slice(0, 5).map((v) => ({
    primary_text: String(v.primary_text || '').slice(0, 300),
    headline: String(v.headline || '').slice(0, 120),
    description: String(v.description || '').slice(0, 120),
    cta: ctas.includes(String(v.cta)) ? String(v.cta) : ctas[0],
    concept: String(v.concept || '').slice(0, 200),
  })).filter((v) => v.primary_text || v.headline);

  if (!clean.length) return { ok: false, error: 'no usable variants returned', status: 502 };
  return { ok: true, variants: clean };
}
