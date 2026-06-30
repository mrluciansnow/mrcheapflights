// Deal scraper library — fetches public flight-deal pages and stores candidates
// in the `scraped_deals` table for admin review. Uses Cloudflare's native
// HTMLRewriter for parsing, which streams HTML without loading it into memory.

const SOURCES = [
  {
    name: 'Secret Flying IE',
    url: 'https://www.secretflying.com/posts/category/ireland/',
    region: 'ie',
    parser: parseSecretFlying,
  },
  {
    name: 'Secret Flying UK',
    url: 'https://www.secretflying.com/posts/category/united-kingdom/',
    region: 'uk',
    parser: parseSecretFlying,
  },
  {
    name: 'Fly4Free IE',
    url: 'https://www.fly4free.com/flight-deals/europe/',
    region: 'ie',
    parser: parseFly4Free,
  },
  {
    name: 'Fly4Free UK',
    url: 'https://www.fly4free.com/flight-deals/from-united-kingdom/',
    region: 'uk',
    parser: parseFly4Free,
  },
];

// Main entry point — scrape all sources and upsert new deals.
export async function runScraper(env) {
  const summary = { sources_checked: 0, deals_found: 0, deals_new: 0, errors: [] };

  for (const source of SOURCES) {
    summary.sources_checked++;
    try {
      const deals = await source.parser(source.url, source.region);
      summary.deals_found += deals.length;

      for (const deal of deals) {
        // Dedup on (source_name, route, price) to avoid repeated scrapes.
        const existing = await env.DB.prepare(
          'SELECT id FROM scraped_deals WHERE source_name=? AND route=? AND price=?'
        ).bind(source.name, deal.route, deal.price).first();

        if (!existing) {
          await env.DB.prepare(
            `INSERT INTO scraped_deals (source_name, source_url, flag, route, dates, price, badge, region, raw_snippet)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            source.name, deal.url || source.url, deal.flag, deal.route,
            deal.dates || '', deal.price, deal.badge || '🔥 Hot', deal.region, deal.snippet || null
          ).run();
          summary.deals_new++;
        }
      }
    } catch (err) {
      summary.errors.push(`${source.name}: ${err.message}`);
    }
  }

  return summary;
}

// ── Parsers ───────────────────────────────────────────────────────────────────

async function parseSecretFlying(url, region) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MrCheapFlightsBot/1.0)' },
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const deals = [];
  let currentTitle = '';
  let currentLink = '';

  await new HTMLRewriter()
    .on('h2.entry-title a, h3.entry-title a', {
      text(chunk) { currentTitle += chunk.text; },
      element(el) {
        currentLink = el.getAttribute('href') || '';
        currentTitle = '';
      },
    })
    .on('h2.entry-title, h3.entry-title', {
      element() {
        if (currentTitle && currentLink) {
          const deal = parseDealTitle(currentTitle.trim(), currentLink, region);
          if (deal) deals.push(deal);
        }
      },
    })
    .transform(res)
    .text(); // consume the stream

  return deals.slice(0, 20);
}

async function parseFly4Free(url, region) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MrCheapFlightsBot/1.0)' },
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const deals = [];
  let currentTitle = '';
  let currentLink = '';

  await new HTMLRewriter()
    .on('article h2 a, .post-title a', {
      text(chunk) { currentTitle += chunk.text; },
      element(el) {
        currentLink = el.getAttribute('href') || '';
        currentTitle = '';
      },
    })
    .on('article h2, .post-title', {
      element() {
        if (currentTitle && currentLink) {
          const deal = parseDealTitle(currentTitle.trim(), currentLink, region);
          if (deal) deals.push(deal);
        }
      },
    })
    .transform(res)
    .text();

  return deals.slice(0, 20);
}

// ── Title parser — extracts route and price from a deal headline ──────────────
// Examples:
//   "Dublin to Lisbon for €29 return"
//   "Flights from London to New York from £189"
//   "🇵🇹 Porto from Dublin €52 return flights"

const PRICE_RE = /[€£$][\d,]+(?:\.\d{1,2})?/;
const ORIGIN_CITY_RE = /(?:from|departing|ex\.?)\s+([A-Za-z\s]+?)(?:\s+to\s+|\s+[-–]\s+)/i;
const DEST_CITY_RE = /to\s+([A-Za-z\s]+?)(?:\s+for\s+|\s+from\s+|\s+[€£$]|\s+return|\s*$)/i;
const COUNTRY_FLAG = {
  portugal: '🇵🇹', spain: '🇪🇸', italy: '🇮🇹', france: '🇫🇷', greece: '🇬🇷',
  turkey: '🇹🇷', usa: '🇺🇸', 'united states': '🇺🇸', 'new york': '🇺🇸',
  canada: '🇨🇦', dubai: '🇦🇪', japan: '🇯🇵', thailand: '🇹🇭', mexico: '🇲🇽',
  brazil: '🇧🇷', morocco: '🇲🇦', egypt: '🇪🇬', croatia: '🇭🇷', malta: '🇲🇹',
  cyprus: '🇨🇾', lisbon: '🇵🇹', barcelona: '🇪🇸', madrid: '🇪🇸', rome: '🇮🇹',
  milan: '🇮🇹', amsterdam: '🇳🇱', paris: '🇫🇷', berlin: '🇩🇪', prague: '🇨🇿',
  budapest: '🇭🇺', warsaw: '🇵🇱', athens: '🇬🇷', ibiza: '🇪🇸', tenerife: '🇪🇸',
  lanzarote: '🇪🇸', fuerteventura: '🇪🇸', gran: '🇪🇸', alicante: '🇪🇸',
};

function guessFlag(text) {
  const lower = text.toLowerCase();
  for (const [keyword, flag] of Object.entries(COUNTRY_FLAG)) {
    if (lower.includes(keyword)) return flag;
  }
  return '✈️';
}

function guessBadge(price, title) {
  const lower = title.toLowerCase();
  const num = parseFloat(String(price).replace(/[^0-9.]/g, ''));
  if (lower.includes('mistake') || lower.includes('error fare')) return '⭐ Featured';
  if (lower.includes('long haul') || lower.includes('transatlantic') || num > 300) return '✈ Long Haul';
  if (lower.includes('flash') || lower.includes('sale')) return '⚡ Flash';
  return '🔥 Hot';
}

function parseDealTitle(title, link, region) {
  const priceMatch = title.match(PRICE_RE);
  if (!priceMatch) return null;
  const price = priceMatch[0];

  const destMatch = title.match(DEST_CITY_RE);
  if (!destMatch) return null;
  const dest = destMatch[1].trim();

  const originMatch = title.match(ORIGIN_CITY_RE);
  const origin = originMatch ? originMatch[1].trim() : (region === 'ie' ? 'Dublin' : 'London');

  const route = `${origin} → ${dest}`;
  const flag = guessFlag(title);
  const badge = guessBadge(price, title);

  return { route, price, flag, badge, url: link, snippet: title.slice(0, 200), region };
}
