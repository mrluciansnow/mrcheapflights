// Deal scraper library — fetches public flight-deal RSS feeds and pages,
// stores candidates in `scraped_deals` for admin review.

// IE airport keywords: all 6 public airports + common name variants
const IE_FILTER = /dublin|ireland|irish|cork|shannon|knock|ireland west|kerry|farranfore|waterford|donegal|city of derry/i;
// UK airport keywords: London (all 6 airports), all major regional airports + country names
const UK_FILTER = /london|heathrow|gatwick|stansted|luton|london city|manchester|birmingham|glasgow|edinburgh|bristol|newcastle|leeds|bradford|liverpool|john lennon|belfast|international|east midlands|nottingham|cardiff|norwich|exeter|uk|britain|england|scotland|wales/i;

const SOURCES = [
  // ── RSS feeds — preferred; reliable structure, light on bandwidth ──────────
  {
    name: 'Fly4Free IE',
    url: 'https://www.fly4free.com/feed/',
    region: 'ie',
    type: 'rss',
    filter: (title) => IE_FILTER.test(title),
  },
  {
    name: 'Fly4Free UK',
    url: 'https://www.fly4free.com/feed/',
    region: 'uk',
    type: 'rss',
    filter: (title) => UK_FILTER.test(title),
  },
  {
    name: 'Travel-Dealz IE',
    url: 'https://www.travel-dealz.eu/feed/',
    region: 'ie',
    type: 'rss',
    filter: (title) => IE_FILTER.test(title),
  },
  {
    name: 'Travel-Dealz UK',
    url: 'https://www.travel-dealz.eu/feed/',
    region: 'uk',
    type: 'rss',
    filter: (title) => UK_FILTER.test(title),
  },
  // The Flight Deal — US-operated but covers transatlantic cheap fares relevant to IE/UK
  {
    name: 'The Flight Deal IE',
    url: 'https://www.theflightdeal.com/feed/',
    region: 'ie',
    type: 'rss',
    filter: (title) => IE_FILTER.test(title),
  },
  {
    name: 'The Flight Deal UK',
    url: 'https://www.theflightdeal.com/feed/',
    region: 'uk',
    type: 'rss',
    filter: (title) => UK_FILTER.test(title),
  },
  // Holiday Pirates — major European deal aggregator with UK/IE-relevant flights
  {
    name: 'Holiday Pirates IE',
    url: 'https://www.holidaypirates.com/feed',
    region: 'ie',
    type: 'rss',
    filter: (title) => IE_FILTER.test(title),
  },
  {
    name: 'Holiday Pirates UK',
    url: 'https://www.holidaypirates.com/feed',
    region: 'uk',
    type: 'rss',
    filter: (title) => UK_FILTER.test(title),
  },
  // ── HTML scrapers — fallback for sites without reliable RSS ───────────────
  {
    name: 'Secret Flying IE',
    url: 'https://www.secretflying.com/posts/category/ireland/',
    region: 'ie',
    type: 'html',
    parser: parseSecretFlying,
  },
  {
    name: 'Secret Flying UK',
    url: 'https://www.secretflying.com/posts/category/united-kingdom/',
    region: 'uk',
    type: 'html',
    parser: parseSecretFlying,
  },
];

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runScraper(env) {
  const summary = { sources_checked: 0, deals_found: 0, deals_new: 0, errors: [] };

  for (const source of SOURCES) {
    summary.sources_checked++;
    try {
      const deals = source.type === 'rss'
        ? await parseRss(source.url, source.region, source.filter)
        : await source.parser(source.url, source.region);

      summary.deals_found += deals.length;

      for (const deal of deals) {
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

// ── RSS parser ───────────────────────────────────────────────────────────────
// Delegates to the text-based parser which is more reliable for RSS/XML than
// HTMLRewriter (which was designed for HTML and struggles with self-closing tags
// and CDATA sections common in RSS feeds).
async function parseRss(url, region, filterFn) {
  return parseRssText(url, region, filterFn);
}

// Text-based RSS parser — more reliable than HTMLRewriter for XML documents.
async function parseRssText(url, region, filterFn) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MrCheapFlightsBot/1.0 (+https://mrcheapflights.ie)' },
    cf: { cacheEverything: true, cacheTtl: 1800 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  const items = [];

  // Extract <item>...</item> blocks
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemRe.exec(text)) !== null) {
    const block = itemMatch[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link') || extractTag(block, 'guid');
    const desc = extractTag(block, 'description');

    if (!title) continue;
    if (filterFn && !filterFn(title + ' ' + (desc || ''))) continue;

    const deal = parseDealTitle(title, link || url, region, desc || '');
    if (deal) {
      deal.snippet = (title + ' — ' + (desc || '')).slice(0, 300);
      items.push(deal);
    }
    if (items.length >= 15) break;
  }

  return items;
}

function extractTag(text, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const m = text.match(re);
  return m ? m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : null;
}

// ── HTML parsers ─────────────────────────────────────────────────────────────

async function parseSecretFlying(url, region) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MrCheapFlightsBot/1.0)' },
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const deals = [];
  const seen = new Set();
  let currentTitle = '';
  let currentLink = '';
  let capturing = false;

  await new HTMLRewriter()
    .on('h2.entry-title a, h3.entry-title a, h2 a, h3 a', {
      element(el) {
        currentLink = el.getAttribute('href') || '';
        currentTitle = '';
        capturing = true;
      },
      text(chunk) {
        if (capturing) currentTitle += chunk.text;
      },
    })
    .on('article', {
      element() {
        if (currentTitle && currentLink && !seen.has(currentLink)) {
          seen.add(currentLink);
          const deal = parseDealTitle(currentTitle.trim(), currentLink, region, '');
          if (deal) deals.push(deal);
          capturing = false;
          currentTitle = '';
          currentLink = '';
        }
      },
    })
    .transform(res)
    .text();

  return deals.slice(0, 20);
}

// ── Deal title parser ────────────────────────────────────────────────────────
// Extracts route and price from a headline like:
//   "Dublin to Lisbon for €29 return"
//   "Flights from London to New York from £189"
//   "Manchester to Barcelona €39 cheap flights"

const PRICE_RE = /([€£$])\s*([\d,]+(?:\.\d{1,2})?)/;

const CITY_ALIASES = {
  'dub': 'Dublin', 'lon': 'London', 'man': 'Manchester',
  'lgw': 'London Gatwick', 'lhr': 'London Heathrow',
};

const COUNTRY_FLAG = {
  portugal: '🇵🇹', spain: '🇪🇸', italy: '🇮🇹', france: '🇫🇷',
  greece: '🇬🇷', turkey: '🇹🇷', usa: '🇺🇸', 'united states': '🇺🇸',
  'new york': '🇺🇸', canada: '🇨🇦', dubai: '🇦🇪', japan: '🇯🇵',
  thailand: '🇹🇭', mexico: '🇲🇽', brazil: '🇧🇷', morocco: '🇲🇦',
  egypt: '🇪🇬', croatia: '🇭🇷', malta: '🇲🇹', cyprus: '🇨🇾',
  lisbon: '🇵🇹', porto: '🇵🇹', barcelona: '🇪🇸', madrid: '🇪🇸',
  rome: '🇮🇹', milan: '🇮🇹', venice: '🇮🇹', amsterdam: '🇳🇱',
  paris: '🇫🇷', berlin: '🇩🇪', prague: '🇨🇿', budapest: '🇭🇺',
  warsaw: '🇵🇱', athens: '🇬🇷', ibiza: '🇪🇸', tenerife: '🇪🇸',
  lanzarote: '🇪🇸', fuerteventura: '🇪🇸', alicante: '🇪🇸',
  palma: '🇪🇸', mallorca: '🇪🇸', majorca: '🇪🇸', reykjavik: '🇮🇸',
  iceland: '🇮🇸', bangkok: '🇹🇭', singapore: '🇸🇬', bali: '🇮🇩',
  indonesia: '🇮🇩', vietnam: '🇻🇳', india: '🇮🇳', delhi: '🇮🇳',
  mumbai: '🇮🇳', kenya: '🇰🇪', 'south africa': '🇿🇦', 'cape town': '🇿🇦',
  australia: '🇦🇺', sydney: '🇦🇺', 'new zealand': '🇳🇿', 'costa rica': '🇨🇷',
  colombia: '🇨🇴', peru: '🇵🇪', chile: '🇨🇱', argentina: '🇦🇷',
  miami: '🇺🇸', orlando: '🇺🇸', 'los angeles': '🇺🇸', cancun: '🇲🇽',
  santorini: '🇬🇷', mykonos: '🇬🇷', rhodes: '🇬🇷', crete: '🇬🇷',
  split: '🇭🇷', dubrovnik: '🇭🇷', faro: '🇵🇹', malaga: '🇪🇸',
  seville: '🇪🇸', valencia: '🇪🇸', toulouse: '🇫🇷', nice: '🇫🇷',
  zurich: '🇨🇭', geneva: '🇨🇭', vienna: '🇦🇹', brussels: '🇧🇪',
  oslo: '🇳🇴', stockholm: '🇸🇪', copenhagen: '🇩🇰', helsinki: '🇫🇮',
};

function guessFlag(text) {
  const lower = text.toLowerCase();
  for (const [keyword, flag] of Object.entries(COUNTRY_FLAG)) {
    if (lower.includes(keyword)) return flag;
  }
  return '✈️';
}

function guessBadge(priceStr, title) {
  const lower = title.toLowerCase();
  const num = parseFloat(String(priceStr).replace(/[^0-9.]/g, ''));
  if (lower.includes('mistake') || lower.includes('error fare')) return '⚠️ Mistake Fare';
  if (lower.includes('business') || lower.includes('premium cabin')) return '⭐ Featured';
  if (lower.includes('long haul') || lower.includes('transatlantic') || num > 299) return '✈ Long Haul';
  if (lower.includes('flash') || lower.includes('sale') || lower.includes('only today')) return '⚡ Flash';
  return '🔥 Hot';
}

function parseDealTitle(title, link, region, desc) {
  const fullText = title + ' ' + desc;
  const priceMatch = fullText.match(PRICE_RE);
  if (!priceMatch) return null;
  const price = priceMatch[1] + priceMatch[2];

  // Extract destination — look for "to <City>" pattern
  const destMatch = fullText.match(/\bto\s+([A-Z][A-Za-z\s]+?)(?:\s+(?:for|from|return|\d)|[,.]|$)/);
  if (!destMatch) return null;
  const dest = destMatch[1].trim().replace(/\s+/g, ' ');
  if (dest.split(/\s+/).length > 4) return null; // skip overly long matches

  // Extract origin — look for "from <City>" pattern
  const originMatch = fullText.match(/\bfrom\s+([A-Z][A-Za-z\s]+?)\s+to\s/);
  const defaultOrigin = region === 'ie' ? 'Dublin' : 'London';
  const origin = originMatch ? originMatch[1].trim() : defaultOrigin;

  if (origin.toLowerCase() === dest.toLowerCase()) return null;

  const route = `${origin} → ${dest}`;
  const flag = guessFlag(fullText);
  const badge = guessBadge(price, fullText);

  return { route, price, flag, badge, url: link, region };
}
