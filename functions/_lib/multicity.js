// Multi-city fan-out — price one destination from every departure city we serve.
//
// When a deal lands for a single origin, this asks Travelpayouts for the same
// destination from each other IE/UK airport and stores a row per origin in
// deal_origins. That one table then feeds three surfaces: the "check from
// other cities" control on the site, per-city Instagram carousel slides, and
// smarter alerts (match a watcher's home airport).
//
// COST: Travelpayouts only — it's free for affiliates and already integrated
// for fare verification. SerpApi is never used here; a fan-out across ~10
// origins would burn the entire monthly free tier in a couple of deals.

import { checkTravelpayouts, parseDealPrice } from './fares.js';
import { routeIatas, buildSearchLink, CITY_IATA, canonicalCity } from './affiliate.js';

// Departure airports we fan out across, per region. Deliberately the airports
// with real scheduled traffic — not every entry in CITY_IATA.
export const FANOUT_ORIGINS = {
  ie: ['dublin', 'cork', 'shannon', 'knock', 'belfast'],
  uk: ['london', 'manchester', 'birmingham', 'edinburgh', 'glasgow', 'bristol', 'newcastle', 'liverpool'],
};

function currencyFor(region) { return region === 'uk' ? 'GBP' : 'EUR'; }
export function symbolFor(currency) { return currency === 'GBP' ? '£' : '€'; }

/** Destination IATA for a deal, or null when the route can't be resolved. */
function destOf(deal) {
  const pair = routeIatas(deal.route, deal.region);
  return pair ? pair.dest : null;
}

/**
 * Price `deal` from every fan-out origin and upsert deal_origins rows.
 * Best-effort: a failing origin is skipped, never throws.
 */
export async function fanOutDeal(env, deal, { maxOrigins = 10 } = {}) {
  const out = { deal_id: deal.id, priced: 0, skipped: 0, errors: 0, cheapest: null };
  const dest = destOf(deal);
  if (!dest) { out.skipped++; out.reason = 'destination unresolved'; return out; }

  const currency = currencyFor(deal.region);
  const marker = (env.TRAVELPAYOUTS_MARKER || '').trim();
  const origins = (FANOUT_ORIGINS[deal.region] || []).slice(0, maxOrigins);

  for (const cityKey of origins) {
    const iata = CITY_IATA[cityKey];
    if (!iata || iata === dest) { out.skipped++; continue; }

    let res;
    try {
      // Reuse the verification client so retries/timeouts/fallbacks are shared.
      res = await checkTravelpayouts(env, { region: deal.region }, { origin: iata, dest });
    } catch { out.errors++; continue; }

    if (res?.skipped) { out.skipped++; continue; }     // no TP token configured
    if (res?.error || res?.status !== 'ok' || res.price == null) { out.errors++; continue; }

    const bookUrl = res.url || buildSearchLink(iata, dest, marker, res.departDate, res.returnDate);
    try {
      await env.DB.prepare(
        `INSERT INTO deal_origins (deal_id, origin_city, origin_iata, price, currency,
            depart_date, return_date, airline, stops, book_url, source, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'travelpayouts', unixepoch())
         ON CONFLICT(deal_id, origin_iata) DO UPDATE SET
           price=excluded.price, currency=excluded.currency, depart_date=excluded.depart_date,
           return_date=excluded.return_date, airline=excluded.airline, stops=excluded.stops,
           book_url=excluded.book_url, checked_at=unixepoch()`
      ).bind(deal.id, canonicalCity(cityKey), iata, res.price, res.currency || currency,
             res.departDate || null, res.returnDate || null, res.airline || null,
             res.stops ?? null, bookUrl).run();
      out.priced++;
      if (out.cheapest == null || res.price < out.cheapest.price) {
        out.cheapest = { city: canonicalCity(cityKey), iata, price: res.price };
      }
    } catch { out.errors++; }
  }

  try {
    await env.DB.prepare('UPDATE deals SET origins_synced_at=unixepoch() WHERE id=?').bind(deal.id).run();
  } catch { /* column missing pre-migration — non-fatal */ }

  return out;
}

/** Cron body: fan out over live deals, stalest (and never-synced) first. */
export async function runFanOut(env, { maxDeals = 4 } = {}) {
  const summary = { considered: 0, priced: 0, errors: 0, deals: [], tp_armed: !!env.TRAVELPAYOUTS_TOKEN };
  if (!summary.tp_armed) { summary.reason = 'TRAVELPAYOUTS_TOKEN not set'; return summary; }

  const { results } = await env.DB.prepare(
    `SELECT id, route, region, price FROM deals
     WHERE status='live' AND (expiry IS NULL OR date(expiry) >= date('now'))
     ORDER BY (origins_synced_at IS NULL) DESC, origins_synced_at ASC
     LIMIT ?`
  ).bind(maxDeals).all();

  for (const deal of results || []) {
    summary.considered++;
    const r = await fanOutDeal(env, deal);
    summary.priced += r.priced;
    summary.errors += r.errors;
    if (r.priced) summary.deals.push({ id: deal.id, route: deal.route, priced: r.priced, cheapest: r.cheapest });
  }
  return summary;
}

/**
 * Origin prices for one deal, cheapest first. Read-only.
 * `listedPrice` (the deal's own headline price) is used to mark which origin
 * the published deal refers to.
 */
export async function originsForDeal(env, dealId, listedPrice) {
  let rows = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT origin_city, origin_iata, price, currency, depart_date, return_date,
              airline, stops, book_url, checked_at
       FROM deal_origins WHERE deal_id=? AND price IS NOT NULL
       ORDER BY price ASC LIMIT 12`
    ).bind(dealId).all();
    rows = results || [];
  } catch { return []; }

  const listed = parseDealPrice(listedPrice);
  return rows.map((r, i) => ({
    ...r,
    symbol: symbolFor(r.currency),
    cheapest: i === 0,
    // Flag origins beating the headline price — the genuinely useful signal.
    beats_listed: listed != null && r.price < listed,
  }));
}

/**
 * How many origins each deal is priced from → { dealId: count }.
 * PUBLIC-SAFE: a count only. It's the hook that makes a guest want to log in
 * ("priced from 5 cities") without leaking a single price. Prices themselves
 * stay behind the same tier gate as fare details.
 */
export async function originsCountsForDeals(env, dealIds) {
  if (!dealIds?.length) return {};
  const marks = dealIds.map(() => '?').join(',');
  try {
    const { results } = await env.DB.prepare(
      `SELECT deal_id, COUNT(*) AS n FROM deal_origins
       WHERE deal_id IN (${marks}) AND price IS NOT NULL GROUP BY deal_id`
    ).bind(...dealIds).all();
    const map = {};
    for (const r of results || []) map[r.deal_id] = r.n;
    return map;
  } catch { return {}; }
}

/** Compact per-city payload for posters/captions (no gating concerns). */
export async function originSlides(env, dealId, limit = 8) {
  const rows = await originsForDeal(env, dealId, null);
  return rows.slice(0, limit).map((r) => ({
    city: r.origin_city, iata: r.origin_iata,
    price: r.price, label: r.symbol + Math.round(r.price),
  }));
}
