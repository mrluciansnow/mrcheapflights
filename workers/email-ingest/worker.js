// Email-ingest worker: inbound deal newsletters → scraped_deals (pending).
// The site's 09:00 enrichment pass then scores these candidates exactly like
// RSS/HTML-scraped ones — junk gets low confidence and dies in review.
//
// Parsing strategy (v1, no MIME dependency): the subject line carries the
// route + price for every major deal newsletter; the body is only scanned
// for the first outbound https link (source_url) and region keywords.

// Mirrors functions/_lib/scraper.js parseDealTitle — kept in sync by hand
// because this worker bundles separately from the Pages Functions tree.
const PRICE_RE = /([€£$])\s*([\d,]+(?:\.\d{1,2})?)/;
const IE_FILTER = /dublin|ireland|irish|cork|shannon|knock|ireland west|kerry|farranfore|waterford|donegal|city of derry/i;
const UK_FILTER = /london|heathrow|gatwick|stansted|luton|manchester|birmingham|glasgow|edinburgh|bristol|newcastle|leeds|liverpool|belfast|east midlands|cardiff|uk|britain|england|scotland|wales/i;

function parseDealSubject(subject, region) {
  const priceMatch = subject.match(PRICE_RE);
  if (!priceMatch) return null;
  const price = priceMatch[1] + priceMatch[2];

  const destMatch = subject.match(/\bto\s+([A-Z][A-Za-z\s]+?)(?:\s+(?:for|from|return|\d)|[,.!]|$)/);
  if (!destMatch) return null;
  const dest = destMatch[1].trim().replace(/\s+/g, ' ');
  if (dest.split(/\s+/).length > 4) return null;

  const originMatch = subject.match(/\bfrom\s+([A-Z][A-Za-z\s]+?)\s+to\s/);
  const origin = originMatch ? originMatch[1].trim() : (region === 'uk' ? 'London' : 'Dublin');
  if (origin.toLowerCase() === dest.toLowerCase()) return null;

  return { route: `${origin} → ${dest}`, price };
}

async function readBody(message, maxBytes) {
  const reader = message.raw.getReader();
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* stream already done */ }
  let text = '';
  for (const c of chunks) text += new TextDecoder('utf-8', { fatal: false }).decode(c, { stream: true });
  return text;
}

export default {
  async email(message, env) {
    const subject = message.headers.get('subject') || '';
    const from = message.from || 'unknown';
    const fromDomain = (from.split('@')[1] || from).toLowerCase().replace(/[>\s]/g, '');
    const sourceName = `Email: ${fromDomain}`;

    // Bounded body read: region hints + first outbound link only.
    let bodyText = '';
    try { bodyText = await readBody(message, 40000); } catch { /* subject-only */ }
    const haystack = subject + ' ' + bodyText.slice(0, 20000);

    // Region: prefer explicit IE signals (the smaller market gets priority),
    // fall back to UK signals, default ie.
    const region = IE_FILTER.test(haystack) ? 'ie' : (UK_FILTER.test(haystack) ? 'uk' : 'ie');

    const deal = parseDealSubject(subject, region);
    if (!deal) return; // not a deal-shaped email — accept silently, store nothing

    // First https link in the body that isn't an unsubscribe/mailto link
    let sourceUrl = '#';
    const linkMatches = bodyText.match(/https:\/\/[^\s"'<>)\]]+/g) || [];
    for (const link of linkMatches) {
      if (/unsub|preferences|mailto|list-manage.com\/unsub/i.test(link)) continue;
      sourceUrl = link.slice(0, 500);
      break;
    }

    // Dedupe on (source, route, price) — same rule as the RSS scraper
    const existing = await env.DB.prepare(
      'SELECT id FROM scraped_deals WHERE source_name=? AND route=? AND price=?'
    ).bind(sourceName, deal.route, deal.price).first();
    if (existing) return;

    await env.DB.prepare(
      `INSERT INTO scraped_deals (source_name, source_url, flag, route, dates, price, badge, region, raw_snippet)
       VALUES (?, ?, '✈️', ?, '', ?, '🔥 Hot', ?, ?)`
    ).bind(sourceName, sourceUrl, deal.route, deal.price, region, subject.slice(0, 300)).run();
  },
};
