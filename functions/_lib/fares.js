// Fare-verification engine — the "army of APIs" that independently checks
// every live deal against real fare data and leaves a link + one-line brief
// on the listing.
//
// Providers (each no-ops cleanly when its key is missing):
//   travelpayouts — api.travelpayouts.com cached Aviasales fares. Free for
//                   affiliates; finds the cheapest CONCRETE date pair for a
//                   route. Env: TRAVELPAYOUTS_TOKEN (profile → API token).
//   google        — real Google Flights results via SerpApi's google_flights
//                   engine (Google killed their public flights API in 2018 —
//                   this is the professional route in). Env: SERPAPI_KEY.
//                   Free tier ≈100 searches/month, so the orchestrator gets a
//                   strict per-run budget and prioritises never-checked deals.
//
// Chain per deal: TP finds cheapest dates → Google verifies that exact pair →
// listing shows "✓ €38 · Ryanair · direct · 14 Oct → 21 Oct" with both links.
// A Google Flights deep link needs NO key at all (constructed), so listings
// always have somewhere to send people even before SerpApi is armed.

import { routeIatas, buildSearchLink } from './affiliate.js';

const VERIFY_TOLERANCE = 0.15; // found ≤ listed×1.15 still counts as verified

export function parseDealPrice(price) {
  const n = parseFloat(String(price || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

function currencyFor(region) { return region === 'uk' ? 'GBP' : 'EUR'; }
function symbolFor(currency) { return currency === 'GBP' ? '£' : '€'; }

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return null;
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Constructed Google Flights deep link — needs no API key. The natural-
 *  language q= form reliably prefills origin/destination/dates. */
export function googleFlightsLink(origin, dest, departDate, returnDate, currency) {
  let q = `Flights to ${dest} from ${origin}`;
  if (departDate) q += ` on ${departDate}`;
  if (returnDate) q += ` through ${returnDate}`;
  return `https://www.google.com/travel/flights?hl=en&curr=${encodeURIComponent(currency || 'EUR')}&q=${encodeURIComponent(q)}`;
}

/** Fallback itinerary when no provider supplied concrete dates: three weeks
 *  out (shifted to Tuesday — cheapest weekday), one-week trip. */
export function heuristicDates() {
  const dep = new Date(Date.now() + 21 * 86400000);
  const shift = (2 - dep.getUTCDay() + 7) % 7; // 2 = Tuesday
  dep.setUTCDate(dep.getUTCDate() + shift);
  const ret = new Date(dep.getTime() + 7 * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { depart: iso(dep), ret: iso(ret) };
}

function verdict(listedPrice, foundPrice) {
  if (foundPrice == null) return 'not_found';
  if (listedPrice == null) return 'verified'; // nothing to compare against
  return foundPrice <= listedPrice * (1 + VERIFY_TOLERANCE) ? 'verified' : 'price_changed';
}

export function buildBrief({ price, currency, airline, stops, departDate, returnDate }) {
  const bits = [];
  if (price != null) bits.push(symbolFor(currency) + Math.round(price));
  if (airline) bits.push(airline);
  if (stops != null) bits.push(stops === 0 ? 'direct' : stops + ' stop' + (stops > 1 ? 's' : ''));
  const dep = fmtDate(departDate), ret = fmtDate(returnDate);
  if (dep && ret) bits.push(dep + ' → ' + ret);
  else if (dep) bits.push(dep);
  return bits.join(' · ');
}

// ── Provider: Travelpayouts Data API (cached Aviasales fares) ────────────────
// Current-gen aviasales/v3 endpoint first (legacy v1 401s on newer accounts
// even with a valid token), v2/prices/latest as the fallback.
async function tpFetch(url, token) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'X-Access-Token': token } });
    clearTimeout(to);
    return res;
  } catch (e) {
    clearTimeout(to);
    throw new Error(e.name === 'AbortError' ? 'timeout' : e.message);
  }
}

export async function checkTravelpayouts(env, deal, pair) {
  // trim(): a trailing newline from a terminal paste 401s the whole provider.
  const token = (env.TRAVELPAYOUTS_TOKEN || '').trim();
  if (!token) return { skipped: 'TRAVELPAYOUTS_TOKEN not set' };
  const currency = currencyFor(deal.region);
  const cur = currency.toLowerCase();

  let best = null, lastErr = null;

  // v3 prices_for_dates — richest shape: price, airline, transfers, dates
  try {
    const res = await tpFetch(
      `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${pair.origin}&destination=${pair.dest}` +
      `&currency=${cur}&sorting=price&limit=10&one_way=false&token=${encodeURIComponent(token)}`, token);
    if (res.ok) {
      const body = await res.json().catch(() => null);
      for (const o of body?.data || []) {
        if (o?.price != null && (!best || o.price < best.price)) {
          best = {
            price: o.price,
            airline: o.airline || null,
            stops: o.transfers ?? null,
            departDate: (o.depart_date || '').slice(0, 10) || null,
            returnDate: (o.return_date || '').slice(0, 10) || null,
          };
        }
      }
      if (!best) return { status: 'not_found' };
    } else {
      lastErr = `v3 HTTP ${res.status}`;
    }
  } catch (e) { lastErr = `v3 ${e.message}`; }

  // v2/prices/latest fallback (no airline field, but real prices + dates)
  if (!best) {
    try {
      const res = await tpFetch(
        `https://api.travelpayouts.com/v2/prices/latest?origin=${pair.origin}&destination=${pair.dest}` +
        `&currency=${cur}&limit=10&one_way=false&token=${encodeURIComponent(token)}`, token);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        for (const o of body?.data || []) {
          const price = o?.value ?? o?.price;
          if (price != null && (!best || price < best.price)) {
            best = {
              price,
              airline: null,
              stops: o.number_of_changes ?? null,
              departDate: (o.depart_date || '').slice(0, 10) || null,
              returnDate: (o.return_date || '').slice(0, 10) || null,
            };
          }
        }
        if (!best) return { status: 'not_found' };
      } else {
        return { error: `${lastErr || ''} / v2 HTTP ${res.status}`.trim() };
      }
    } catch (e) {
      return { error: `${lastErr || ''} / v2 ${e.message}`.trim() };
    }
  }

  return {
    status: 'ok',
    price: best.price,
    currency,
    airline: best.airline,
    stops: best.stops,
    departDate: best.departDate,
    returnDate: best.returnDate,
    url: buildSearchLink(pair.origin, pair.dest, (env.TRAVELPAYOUTS_MARKER || '').trim(), best.departDate, best.returnDate),
  };
}

// ── Provider: Google Flights via SerpApi ─────────────────────────────────────
export async function checkGoogle(env, deal, pair, departDate, returnDate) {
  const key = (env.SERPAPI_KEY || '').trim();
  if (!key) return { skipped: 'SERPAPI_KEY not set' };
  const currency = currencyFor(deal.region);

  const params = new URLSearchParams({
    engine: 'google_flights',
    departure_id: pair.origin,
    arrival_id: pair.dest,
    outbound_date: departDate,
    return_date: returnDate,
    currency,
    hl: 'en',
    api_key: key,
  });
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: controller.signal });
  } catch (e) {
    clearTimeout(to);
    return { error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
  clearTimeout(to);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { error: `HTTP ${res.status}: ${body.slice(0, 120)}` };
  }

  const body = await res.json().catch(() => null);
  const flights = body?.best_flights?.length ? body.best_flights : body?.other_flights;
  if (!flights || !flights.length) return { status: 'not_found' };

  let best = null;
  for (const f of flights) {
    if (f?.price != null && (!best || f.price < best.price)) best = f;
  }
  if (!best) return { status: 'not_found' };

  const legs = best.flights || [];
  return {
    status: 'ok',
    price: best.price,
    currency,
    airline: legs[0]?.airline || null,
    stops: Math.max(0, legs.length - 1),
    durationMin: best.total_duration || null,
    departDate,
    returnDate,
    url: body?.search_metadata?.google_flights_url
      || googleFlightsLink(pair.origin, pair.dest, departDate, returnDate, currency),
  };
}

async function upsertCheck(env, dealId, source, listedPrice, r) {
  const status = r.error ? 'error' : r.status === 'not_found' ? 'not_found' : verdict(listedPrice, r.price);
  // Errors are stored in `brief` (NULL otherwise for non-display rows) so a
  // failing provider is diagnosable from the table instead of vanishing.
  const brief = (status === 'verified' || status === 'price_changed')
    ? buildBrief({ price: r.price, currency: r.currency, airline: r.airline, stops: r.stops, departDate: r.departDate, returnDate: r.returnDate })
    : status === 'error' ? String(r.error).slice(0, 140)
    : null;
  await env.DB.prepare(
    `INSERT INTO fare_checks (deal_id, source, status, price_found, currency, depart_date, return_date,
                              airline, stops, duration_min, url, brief, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(deal_id, source) DO UPDATE SET
       status=excluded.status, price_found=excluded.price_found, currency=excluded.currency,
       depart_date=excluded.depart_date, return_date=excluded.return_date, airline=excluded.airline,
       stops=excluded.stops, duration_min=excluded.duration_min, url=excluded.url,
       brief=excluded.brief, checked_at=unixepoch()`
  ).bind(dealId, source, status, r.price ?? null, r.currency ?? null, r.departDate ?? null,
         r.returnDate ?? null, r.airline ?? null, r.stops ?? null, r.durationMin ?? null,
         r.url ?? null, brief).run();
  return status;
}

/** Run fare checks over live deals. Prioritises never-checked deals, then the
 *  stalest. Budgets keep SerpApi's free tier alive (≈100/month). */
export async function runFareChecks(env, { maxDeals = 15, maxGoogle = 1 } = {}) {
  const summary = {
    deals_considered: 0, tp_checked: 0, google_checked: 0,
    verified: 0, price_changed: 0, not_found: 0, errors: 0,
    tp_armed: !!env.TRAVELPAYOUTS_TOKEN, google_armed: !!env.SERPAPI_KEY,
  };

  const { results: deals } = await env.DB.prepare(
    `SELECT d.id, d.route, d.price, d.region,
            (SELECT MIN(checked_at) FROM fare_checks fc WHERE fc.deal_id = d.id) AS last_checked
     FROM deals d
     WHERE d.status='live' AND (d.expiry IS NULL OR date(d.expiry) >= date('now'))
     ORDER BY (last_checked IS NULL) DESC, last_checked ASC
     LIMIT ?`
  ).bind(maxDeals).all();

  let googleBudget = maxGoogle;
  for (const deal of deals || []) {
    summary.deals_considered++;
    const pair = routeIatas(deal.route, deal.region);
    if (!pair) continue;
    const listedPrice = parseDealPrice(deal.price);

    // 1. Travelpayouts — cheap, broad, finds concrete dates
    let tpDates = null;
    const tp = await checkTravelpayouts(env, deal, pair);
    if (!tp.skipped) {
      summary.tp_checked++;
      const st = await upsertCheck(env, deal.id, 'travelpayouts', listedPrice, tp);
      summary[st === 'verified' ? 'verified' : st === 'price_changed' ? 'price_changed' : st === 'not_found' ? 'not_found' : 'errors']++;
      if (tp.departDate) tpDates = { depart: tp.departDate, ret: tp.returnDate };
    }

    // 2. Google (SerpApi) — precious budget; verify TP's dates or a heuristic pair
    if (googleBudget > 0 && env.SERPAPI_KEY) {
      const dates = tpDates || heuristicDates();
      const g = await checkGoogle(env, deal, pair, dates.depart, dates.ret || dates.depart);
      if (!g.skipped) {
        googleBudget--;
        summary.google_checked++;
        const st = await upsertCheck(env, deal.id, 'google', listedPrice, g);
        summary[st === 'verified' ? 'verified' : st === 'price_changed' ? 'price_changed' : st === 'not_found' ? 'not_found' : 'errors']++;
      }
    }
  }
  return summary;
}

/** Fetch fare rows for a set of deal ids → { dealId: { google: row, travelpayouts: row } } */
export async function fareMapForDeals(env, dealIds) {
  if (!dealIds.length) return {};
  const marks = dealIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT deal_id, source, status, price_found, currency, depart_date, return_date,
            airline, stops, duration_min, url, brief, checked_at
     FROM fare_checks WHERE deal_id IN (${marks})`
  ).bind(...dealIds).all();
  const map = {};
  for (const r of results || []) {
    (map[r.deal_id] = map[r.deal_id] || {})[r.source] = r;
  }
  return map;
}

/** Collapse a deal's fare rows into the public payload members see.
 *  Google wins as the display source (that's the trust anchor); the
 *  affiliate link still comes along for the booking click. */
export function publicFare(deal, rows, marker) {
  const pair = routeIatas(deal.route, deal.region);
  const currency = currencyFor(deal.region);
  const g = rows?.google, tp = rows?.travelpayouts;
  const primary = (g && (g.status === 'verified' || g.status === 'price_changed')) ? g
                : (tp && (tp.status === 'verified' || tp.status === 'price_changed')) ? tp
                : null;
  const googleUrl = (g && g.url) || (pair
    ? googleFlightsLink(pair.origin, pair.dest, primary?.depart_date, primary?.return_date, currency)
    : null);
  if (!primary) {
    // Nothing verified yet — still hand members the Google link so the
    // listing has somewhere useful to send them.
    return googleUrl ? { status: 'unchecked', google_url: googleUrl } : null;
  }
  return {
    status: primary.status,                    // 'verified' | 'price_changed'
    source: primary === g ? 'google' : 'travelpayouts',
    brief: primary.brief,
    price_found: primary.price_found,
    currency: primary.currency,
    depart_date: primary.depart_date,
    return_date: primary.return_date,
    airline: primary.airline,
    stops: primary.stops,
    google_url: googleUrl,
    book_url: (tp && tp.url) || null,
    checked_at: primary.checked_at,
  };
}
