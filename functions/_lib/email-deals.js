// Newsletter → deal candidates.
//
// The best fares arrive by EMAIL, not RSS: Jack's Flight Club, Secret Flying,
// Going, Travel-Dealz. Secret Flying in particular hard-blocks Cloudflare
// Worker IPs (403), so email is the only way in.
//
// Two things make newsletters worth the effort:
//   1. One email carries SEVERAL deals, so a single message can restock the
//      queue where an RSS item yields one candidate.
//   2. They routinely quote one destination from MANY departure cities
//      ("London £229 · Manchester £249 · Dublin €279"), which is exactly the
//      shape the multi-city carousel wants — so those become one candidate
//      with several origins rather than several unrelated candidates.
//
// Parsing reuses the RSS parser's rules, so resolve-or-reject, the non-flight
// guard and currency-per-region all apply identically. Nothing invented.

import { parseDealTitle, extractPrice, extractDates, stripEmoji, isFlightDeal } from './scraper.js';
import { resolveCityKey, canonicalCity, REGION_ORIGINS, CITY_IATA } from './affiliate.js';

/** Strip HTML to readable text, keeping line structure so deal blocks survive. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** First https link in a block — the "book it" target when one is present. */
function firstLink(html) {
  const m = String(html || '').match(/https?:\/\/[^\s"'<>)]+/);
  return m ? m[0] : null;
}

// A line offering the same destination from several airports:
//   "London £229 · Manchester £249 · Edinburgh £239"
const CITY_PRICE_RE = /([A-Za-z][A-Za-z\s]{2,24}?)\s*[:\-–—]?\s*([€£])\s?(\d{2,4})/g;

/**
 * Pull "<City> <price>" pairs from a line, keeping only cities we actually
 * depart from. Returns [] when fewer than two resolve — one pair is just a
 * normal deal line, not a multi-origin list.
 */
export function extractOriginPrices(line, region) {
  const t = stripEmoji(line);
  const allowed = REGION_ORIGINS[region] || [];
  const seen = new Map();
  for (const m of t.matchAll(CITY_PRICE_RE)) {
    const key = resolveCityKey(m[1]);
    if (!key || !allowed.includes(key)) continue;
    const price = parseFloat(m[3]);
    if (!Number.isFinite(price) || price <= 0 || price > 3000) continue;
    if (!seen.has(key)) seen.set(key, { city: canonicalCity(key), iata: CITY_IATA[key], symbol: m[2], price });
  }
  return seen.size >= 2 ? [...seen.values()] : [];
}

/**
 * Parse a whole newsletter into candidates.
 * Returns [{ route, price, dates, badge, flag, region, url, snippet, origins }]
 * where `origins` is populated when the email listed several departure cities.
 */
export function parseNewsletter({ html, text, subject, region }) {
  const body = htmlToText(html || '') || String(text || '');
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  const seenRoutes = new Set();

  // Look at each line plus a little following context — newsletters usually put
  // the headline on one line and the price/dates just beneath it.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 12 || line.length > 220) continue;
    if (!isFlightDeal(line)) continue;

    const context = lines.slice(i, i + 3).join(' ');
    const deal = parseDealTitle(line, null, region, lines.slice(i + 1, i + 3).join(' '));
    if (!deal) continue;

    const key = deal.route.toLowerCase();
    if (seenRoutes.has(key)) continue;
    seenRoutes.add(key);

    // Multi-origin list in the surrounding lines → one deal, many origins.
    //
    // A nearby city/price list is NOT automatically this deal's: a newsletter
    // lists many deals, so the block under "Dublin to Lisbon €29" may belong to
    // the next one down. Require the deal's own price to appear among the
    // origins — that's what proves the list is describing THIS fare. Without
    // the check, every deal in the email inherited whichever list came first.
    const dealNum = extractPrice(deal.price, region)?.num ?? null;
    let origins = [];
    for (const cand of lines.slice(i, i + 4)) {
      const found = extractOriginPrices(cand, region);
      if (!found.length) continue;
      if (dealNum != null && !found.some((o) => Math.abs(o.price - dealNum) <= 1)) continue;
      origins = found;
      break;
    }

    if (!deal.dates) deal.dates = extractDates(context);
    out.push({
      ...deal,
      url: null,                      // filled by the caller from the email link
      snippet: `${line} — ${lines.slice(i + 1, i + 2).join(' ')}`.slice(0, 300),
      origins,
    });
    if (out.length >= 12) break;      // one newsletter shouldn't flood the queue
  }

  // Subject lines often carry the headline deal that the body only elaborates.
  if (subject && isFlightDeal(subject)) {
    const sd = parseDealTitle(subject, null, region, '');
    if (sd && !seenRoutes.has(sd.route.toLowerCase())) {
      out.unshift({ ...sd, url: null, snippet: `${subject}`.slice(0, 300), origins: [] });
    }
  }

  const link = firstLink(html);
  for (const d of out) if (!d.url && link) d.url = link;
  return out;
}
