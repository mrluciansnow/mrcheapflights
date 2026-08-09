// Deal scraper library — fetches public flight-deal RSS feeds and pages,
// stores candidates in `scraped_deals` for admin review.
//
// PARSING RULE: resolve-or-reject. Origin and destination must both resolve to
// a city we know, and the origin must be an airport we actually serve. Nothing
// is ever defaulted — see extractRoute() for why that matters.

import { resolveCityKey, canonicalCity, REGION_ORIGINS } from './affiliate.js';

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
  // NOTE: Secret Flying was removed 2026-07-11 — it hard-blocks Cloudflare
  // Worker IPs with HTTP 403 on both its HTML pages and RSS feeds. Expanding
  // deal flow is handled by the email-ingest worker (forwarded newsletters)
  // rather than fighting bot protection. Add new RSS sources here.
];

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Fetch every distinct feed ONCE and apply each region's filter to the result.
 *
 * SOURCES lists 8 entries but only 4 distinct URLs — the same feed appeared
 * once for 'ie' and again for 'uk', so every run fetched identical bytes twice,
 * doubling requests and latency for nothing. Feeds are also fetched in
 * PARALLEL now: they're independent, and serialising four network round-trips
 * was the bulk of the scrape's wall-clock time (which matters, since this runs
 * under a 30s scheduler ceiling).
 */
export async function runScraper(env) {
  const summary = {
    sources_checked: 0, feeds_fetched: 0, deals_found: 0, deals_new: 0,
    deals_updated: 0, errors: [], sources: {},
  };

  // Group the source list by URL so each feed is fetched exactly once.
  const byUrl = new Map();
  for (const s of SOURCES) {
    if (!byUrl.has(s.url)) byUrl.set(s.url, []);
    byUrl.get(s.url).push(s);
    summary.sources_checked++;
  }

  const fetched = await Promise.all([...byUrl.keys()].map(async (url) => {
    try {
      return { url, text: await fetchFeed(url), error: null };
    } catch (err) {
      return { url, text: null, error: err.message };
    }
  }));
  summary.feeds_fetched = fetched.length;

  for (const { url, text, error } of fetched) {
    const variants = byUrl.get(url);
    if (error) {
      for (const s of variants) {
        summary.errors.push(`${s.name}: ${error}`);
        summary.sources[s.name] = { ok: false, found: 0, error };
      }
      continue;
    }
    for (const source of variants) {
      try {
        const deals = parseFeedText(text, url, source.region, source.filter);
        summary.deals_found += deals.length;
        // Per-source outcome, so a feed that has silently stopped producing
        // anything is visible instead of hiding inside an aggregate count.
        summary.sources[source.name] = { ok: true, found: deals.length, error: null };

        for (const deal of deals) {
          const r = await upsertCandidate(env, source, deal);
          if (r === 'new') summary.deals_new++;
          else if (r === 'updated') summary.deals_updated++;
        }
      } catch (err) {
        summary.errors.push(`${source.name}: ${err.message}`);
        summary.sources[source.name] = { ok: false, found: 0, error: err.message };
      }
    }
  }

  return summary;
}

/**
 * Insert a candidate, or UPDATE the existing one when the same route is
 * re-listed at a new price.
 *
 * The old dedup keyed on (source_name, route, price) exactly, so a feed
 * re-publishing the same deal a few pounds cheaper created a second pending
 * row — the queue filled with near-duplicates of the same fare. Matching on
 * route+region instead means a price move refreshes the candidate we already
 * have, and re-scores it (confidence=NULL) because the price it was judged on
 * has changed.
 */
async function upsertCandidate(env, source, deal) {
  const existing = await env.DB.prepare(
    `SELECT id, price FROM scraped_deals
     WHERE source_name=? AND route=? AND region=? AND status='pending'
     ORDER BY id DESC LIMIT 1`
  ).bind(source.name, deal.route, deal.region).first();

  if (existing) {
    if (existing.price === deal.price) return 'seen';   // nothing changed
    await env.DB.prepare(
      `UPDATE scraped_deals SET price=?, dates=?, badge=?, raw_snippet=?,
         confidence=NULL, updated_at=unixepoch() WHERE id=?`
    ).bind(deal.price, deal.dates || '', deal.badge || '🔥 Hot',
           deal.snippet || null, existing.id).run();
    return 'updated';
  }

  await env.DB.prepare(
    `INSERT INTO scraped_deals (source_name, source_url, flag, route, dates, price, badge, region, raw_snippet)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(source.name, deal.url || source.url, deal.flag, deal.route,
         deal.dates || '', deal.price, deal.badge || '🔥 Hot', deal.region, deal.snippet || null).run();
  return 'new';
}

// ── RSS parser ───────────────────────────────────────────────────────────────
// Delegates to the text-based parser which is more reliable for RSS/XML than
// HTMLRewriter (which was designed for HTML and struggles with self-closing tags
// and CDATA sections common in RSS feeds).
/**
 * Fetch one feed. Retries once on a transient failure (network blip or 5xx)
 * with a short backoff — a single flaky response used to cost the source its
 * entire daily run, since the scrape only fires once a day. 4xx is NOT retried:
 * a 403 (Secret Flying blocks Worker IPs) or 404 won't fix itself on a retry.
 */
async function fetchFeed(url, attempt = 0) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MrCheapFlightsBot/1.0 (+https://mrcheapflights.ie)' },
      cf: { cacheEverything: true, cacheTtl: 1800 },
      signal: controller.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      if (res.status >= 500 && attempt < 1) {
        await new Promise((r) => setTimeout(r, 800));
        return fetchFeed(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } catch (e) {
    clearTimeout(to);
    const transient = e.name === 'AbortError' || /network|fetch failed|socket/i.test(e.message || '');
    if (transient && attempt < 1) {
      await new Promise((r) => setTimeout(r, 800));
      return fetchFeed(url, attempt + 1);
    }
    throw new Error(e.name === 'AbortError' ? 'timeout' : e.message);
  }
}

// Text-based RSS parsing — more reliable than HTMLRewriter for XML documents.
// Split from fetching so one download can serve several region filters.
function parseFeedText(text, url, region, filterFn) {
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

// ── Deal title parser ────────────────────────────────────────────────────────
// Extracts route and price from a headline like:
//   "Dublin to Lisbon for €29 return"
//   "Flights from London to New York from £189"
//   "Manchester to Barcelona €39 cheap flights"

const PRICE_RE = /([€£$])\s*([\d,]+(?:\.\d{1,2})?)/g;

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

// `num` is the already-normalised numeric price in the region's own currency —
// the old signature took a display string and re-parsed it, which compared
// across currencies (a $ figure judged against a € threshold).
function guessBadge(num, title) {
  const lower = title.toLowerCase();
  if (lower.includes('mistake') || lower.includes('error fare')) return '⚠️ Mistake Fare';
  if (lower.includes('business') || lower.includes('premium cabin')) return '⭐ Featured';
  if (lower.includes('long haul') || lower.includes('transatlantic') || num > 299) return '✈ Long Haul';
  if (lower.includes('flash') || lower.includes('sale') || lower.includes('only today')) return '⚡ Flash';
  return '🔥 Hot';
}

// ── Price ────────────────────────────────────────────────────────────────────
// Region decides the currency: an IE deal is priced in €, a UK deal in £.
// Previously the first symbol found anywhere won, so a $ fare from a US feed
// could be stored as an Irish price. No matching currency ⇒ reject.
const CURRENCY_FOR = { ie: '€', uk: '£' };

export function extractPrice(text, region) {
  const want = CURRENCY_FOR[region] || '€';
  const found = [...String(text).matchAll(PRICE_RE)]
    .map((m) => ({ sym: m[1], num: parseFloat(m[2].replace(/,/g, '')) }))
    .filter((p) => Number.isFinite(p.num) && p.num > 0);
  const hit = found.find((p) => p.sym === want);
  if (!hit) return null;
  // A "flight deal" of €5000 is a package/business fare mis-scrape, not a deal.
  if (hit.num > 3000) return null;
  return { display: want + (Number.isInteger(hit.num) ? hit.num : hit.num.toFixed(2)), num: hit.num };
}

// ── Route ────────────────────────────────────────────────────────────────────
// RESOLVE-OR-REJECT. Both endpoints must resolve to a city we actually know;
// nothing is defaulted. The old parser fell back to Dublin/London whenever its
// "from X to Y" pattern missed, which republished "Cork to Lisbon" as
// "Dublin → Lisbon" — inventing a departure airport the deal never mentioned.
// NB: "new" is deliberately NOT a noise word — stripping it turns "New York"
// into "York" and the deal is then rejected as unresolvable.
const NOISE = /^(the|a|an|book|see|get|find|save|our|your|this|that|these|more|all|now|here|cheap|flights?|deals?|return|today|tomorrow)$/i;

function cleanFragment(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/^(the|a|an)\s+/i, '')
    .split(/\s+/).filter((w) => !NOISE.test(w)).join(' ');
}

/** Pull candidate "<A> to <B>" pairs and keep the first where BOTH resolve. */
// Feeds pepper headlines with emoji ("Manchester to Japan 🍣 from £519"), which
// sat between the city and its terminator and made the pattern miss — silently
// dropping valid deals. Strip pictographs/flags before matching.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}]/gu;

export function stripEmoji(s) {
  return String(s).replace(EMOJI_RE, ' ').replace(/\s+/g, ' ').trim();
}

export function extractRoute(text, region) {
  const t = stripEmoji(text);
  const origins = REGION_ORIGINS[region] || [];

  // Pattern 1: "<Origin> to <Dest>" — the dominant headline form.
  const pairRe = /([A-Za-z][A-Za-z\s]{1,28}?)\s+to\s+([A-Za-z][A-Za-z\s]{1,28}?)(?=\s*(?:[,.;:!?–—-]|\bfor\b|\bfrom\b|\breturn\b|\bwith\b|\bin\b|\bon\b|[€£$]|\d|$))/gi;
  for (const m of t.matchAll(pairRe)) {
    const oKey = resolveCityKey(cleanFragment(m[1]));
    const dKey = resolveCityKey(cleanFragment(m[2]));
    if (!oKey || !dKey || oKey === dKey) continue;
    if (!origins.includes(oKey)) continue;      // origin must be an airport we serve
    return { originKey: oKey, destKey: dKey };
  }

  // Pattern 2: "flights to <Dest> from <Origin>" (origin trails the destination).
  const revRe = /\bto\s+([A-Za-z][A-Za-z\s]{1,28}?)\s+from\s+([A-Za-z][A-Za-z\s]{1,28}?)(?=\s*(?:[,.;:!?–—-]|\bfor\b|[€£$]|\d|$))/gi;
  for (const m of t.matchAll(revRe)) {
    const dKey = resolveCityKey(cleanFragment(m[1]));
    const oKey = resolveCityKey(cleanFragment(m[2]));
    if (!oKey || !dKey || oKey === dKey) continue;
    if (!origins.includes(oKey)) continue;
    return { originKey: oKey, destKey: dKey };
  }

  return null; // unresolvable ⇒ caller rejects. Never guess an origin.
}

// ── Travel dates ─────────────────────────────────────────────────────────────
// `dates` was always empty, which also meant deals never got an expiry.
const MONTHS = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const MON_TITLE = { jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
  jul: 'Jul', aug: 'Aug', sep: 'Sep', sept: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec' };

export function extractDates(text) {
  const t = String(text).replace(/\s+/g, ' ');
  // "12–19 Nov" / "12 - 19 November"
  let m = t.match(new RegExp(`\\b(\\d{1,2})\\s*[–—-]\\s*(\\d{1,2})\\s+${MONTHS}`, 'i'));
  if (m) return `${m[1]}–${m[2]} ${MON_TITLE[m[3].toLowerCase().slice(0, 3)]}`;
  // "Nov 12-19"
  m = t.match(new RegExp(`\\b${MONTHS}\\s+(\\d{1,2})\\s*[–—-]\\s*(\\d{1,2})\\b`, 'i'));
  if (m) return `${m[2]}–${m[3]} ${MON_TITLE[m[1].toLowerCase().slice(0, 3)]}`;
  // "Jan-Mar" / "January to March" (a season, not exact days)
  m = t.match(new RegExp(`\\b${MONTHS}\\s*(?:[–—-]|\\bto\\b)\\s*${MONTHS}\\b`, 'i'));
  if (m) return `${MON_TITLE[m[1].toLowerCase().slice(0, 3)]}–${MON_TITLE[m[2].toLowerCase().slice(0, 3)]}`;
  // "travel in October" / "departing March"
  m = t.match(new RegExp(`\\b(?:in|during|departing|travel(?:ling)?\\s+in)\\s+${MONTHS}\\b`, 'i'));
  if (m) return MON_TITLE[m[1].toLowerCase().slice(0, 3)];
  return '';
}

// We publish FLIGHT deals. Aggregators like HolidayPirates mix in ferries,
// hotels, theatre tickets and packages — several of which do name a real
// city pair and a price, so they'd otherwise parse as flights.
const NON_FLIGHT = /\b(mini-?cruise|cruise|ferry|sail(?:ing)?\s+to|travelodge|premier\s+inn|hotel|hostel|b&b|theatre|musical|concert|festival\s+ticket|spa\s+day|mini-?break|city\s+break|all-?inclusive|half-?board|full-?board|nights?\s+(?:stay|hotel|b&b)|disneyland\s+tickets?|park\s+tickets?)\b/i;

export function isFlightDeal(text) {
  const t = stripEmoji(text);
  // "flights + hotel" packages are still not a flight fare we can price.
  if (NON_FLIGHT.test(t)) return false;
  return true;
}

// ── Expiry ───────────────────────────────────────────────────────────────────
// Nothing ever set deals.expiry, with two bad consequences: dated deals died
// silently once their travel window passed (mrcheapflights.ie hit ZERO live
// deals on 2026-08-01 this way), and deals without dates never expired at all,
// so a months-old fare could sit on the site indefinitely.
//
// Rule: a deal is worth showing until shortly before its travel window opens;
// with no parsed window, fall back to a conservative shelf life. Deal pages
// stay reachable — expiry only removes it from the live listings.
const DEFAULT_SHELF_DAYS = 21;
const MON_NUM = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function deriveExpiry(dates, now = new Date()) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const fallback = () => iso(new Date(now.getTime() + DEFAULT_SHELF_DAYS * 86400000));
  const t = String(dates || '').trim();
  if (!t) return fallback();

  // "12–19 Nov" → expire the day the trip starts. "Nov" / "Jan–Mar" → expire at
  // the end of that month (the window is vague, so don't over-claim precision).
  const m = t.match(/^(\d{1,2})[–—-]\d{1,2}\s+([A-Za-z]{3})/) || t.match(/^([A-Za-z]{3})/);
  let month, day = null;
  if (m && /^\d/.test(m[1])) { day = parseInt(m[1], 10); month = MON_NUM[m[2].toLowerCase()]; }
  else if (m) { month = MON_NUM[m[1].toLowerCase()]; }
  if (month == null) return fallback();

  // Month with no year: pick the next occurrence, so "Feb" seen in December
  // means next February rather than one already past.
  let year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month, day || 1));
  if (candidate < now) { year++; }
  const target = day
    ? new Date(Date.UTC(year, month, day))
    : new Date(Date.UTC(year, month + 1, 0)); // last day of that month

  // Never publish something already expired, and never further out than a year.
  const min = new Date(now.getTime() + 3 * 86400000);
  const max = new Date(now.getTime() + 365 * 86400000);
  if (target < min) return fallback();
  return iso(target > max ? max : target);
}

/**
 * Does an AI-written caption actually describe THIS deal?
 *
 * Captions used to be accepted on type and length alone, so a hallucinated
 * price or the wrong city could be published to Instagram under our branding —
 * on a site whose whole promise is "every deal independently fare-checked".
 * The caption must mention the deal's price digits and its destination.
 * Exported so the rule is testable instead of buried in the enrich endpoint.
 */
export function captionMatchesDeal(caption, route, price) {
  const t = String(caption || '').toLowerCase();
  if (!t) return false;
  const wantPrice = String(price || '').replace(/[^0-9]/g, '');
  // Compare digits-only so "€1,299" in the deal matches "1299" or "€1,299".
  if (wantPrice && !t.replace(/[^0-9]/g, '').includes(wantPrice)) return false;
  const dest = (String(route || '').split(/→|->/)[1] || '').trim().toLowerCase();
  if (!dest) return true;
  // Any significant word of a multi-word destination counts ("New York" → "york").
  return dest.split(/\s+/).some((w) => w.length > 2 && t.includes(w));
}

export function parseDealTitle(title, link, region, desc) {
  const fullText = `${title} ${desc || ''}`;

  // Judge the headline only: descriptions often mention a hotel in passing.
  if (!isFlightDeal(title)) return null;

  const price = extractPrice(fullText, region);
  if (!price) return null;

  const pair = extractRoute(fullText, region);
  if (!pair) return null;

  const origin = canonicalCity(pair.originKey);
  const dest = canonicalCity(pair.destKey);

  return {
    route: `${origin} → ${dest}`,
    price: price.display,
    dates: extractDates(fullText),
    flag: guessFlag(dest) !== '✈️' ? guessFlag(dest) : guessFlag(fullText),
    badge: guessBadge(price.num, fullText),
    url: link,
    region,
  };
}
