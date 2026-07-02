// Affiliate link layer — port of the Phase 4 pack's buildAffiliateUrl.ts,
// adapted for Cloudflare Workers (env passed as param, no process.env) and
// this site's data model (routes are display text "Dublin → Lisbon", not IATA).
//
// Every booking link we *generate* goes through here — this is the revenue layer.
// Deal source URLs (scraped articles) are left untouched; instead we derive a
// parallel "check live fares" Aviasales search link from the route text.
//
// ── AFFILIATE SHELL ───────────────────────────────────────────────
// Register: https://www.travelpayouts.com (instant approval)
// Env var:  TRAVELPAYOUTS_MARKER (your partner ID)
//   wrangler pages secret put TRAVELPAYOUTS_MARKER --project-name mrcheap
// Without the marker set, links fall back to clean non-affiliate URLs
// so published posts still work — revenue just isn't tracked yet.
// ──────────────────────────────────────────────────────────────────

// Travelpayouts program IDs (p=) for the tp.media redirect wrapper
const PROGRAMS = {
  aviasales: { trs: '383854', p: '4114' },
  kiwi: { trs: '383854', p: '8159' },
};

export function wrapAffiliate(targetUrl, marker, program = 'aviasales') {
  if (!marker) return targetUrl; // SHELL fallback: clean link, no tracking
  const { trs, p } = PROGRAMS[program] || PROGRAMS.aviasales;
  return `https://tp.media/r?marker=${encodeURIComponent(marker)}&trs=${trs}&p=${p}&u=${encodeURIComponent(targetUrl)}`;
}

/** Deep search link on Aviasales (Travelpayouts' own engine — best commission).
 *  Dates optional — without them the link lands on a pre-filled search. */
export function buildSearchLink(originIata, destIata, marker, outboundDate, returnDate) {
  const fmt = (d) => (d ? d.slice(8, 10) + d.slice(5, 7) : '');
  const target = `https://www.aviasales.com/search/${originIata}${fmt(outboundDate)}${destIata}${fmt(returnDate)}`;
  return wrapAffiliate(target, marker, 'aviasales');
}

// ── City → IATA map ──────────────────────────────────────────────────────────
// Covers every IE/UK origin the scraper filters for, plus the destination set
// mirrored from the scraper's COUNTRY_FLAG list. Metro codes (LON, NYC, ROM…)
// are valid on Aviasales and preferred where a city has several airports.
const CITY_IATA = {
  // ── IE origins ──
  'dublin': 'DUB', 'cork': 'ORK', 'shannon': 'SNN', 'knock': 'NOC',
  'ireland west': 'NOC', 'kerry': 'KIR', 'farranfore': 'KIR', 'belfast': 'BFS',
  // ── UK origins ──
  'london': 'LON', 'heathrow': 'LHR', 'gatwick': 'LGW', 'stansted': 'STN',
  'luton': 'LTN', 'manchester': 'MAN', 'birmingham': 'BHX', 'glasgow': 'GLA',
  'edinburgh': 'EDI', 'bristol': 'BRS', 'newcastle': 'NCL', 'leeds': 'LBA',
  'liverpool': 'LPL', 'cardiff': 'CWL', 'aberdeen': 'ABZ', 'east midlands': 'EMA',
  // ── Destinations ──
  'lisbon': 'LIS', 'porto': 'OPO', 'faro': 'FAO', 'madeira': 'FNC', 'funchal': 'FNC',
  'barcelona': 'BCN', 'madrid': 'MAD', 'malaga': 'AGP', 'alicante': 'ALC',
  'seville': 'SVQ', 'valencia': 'VLC', 'palma': 'PMI', 'mallorca': 'PMI',
  'majorca': 'PMI', 'ibiza': 'IBZ', 'tenerife': 'TFS', 'lanzarote': 'ACE',
  'fuerteventura': 'FUE', 'gran canaria': 'LPA',
  'rome': 'ROM', 'milan': 'MIL', 'venice': 'VCE', 'naples': 'NAP',
  'amsterdam': 'AMS', 'paris': 'PAR', 'nice': 'NCE', 'toulouse': 'TLS',
  'berlin': 'BER', 'munich': 'MUC', 'frankfurt': 'FRA',
  'prague': 'PRG', 'budapest': 'BUD', 'warsaw': 'WAW', 'krakow': 'KRK',
  'vienna': 'VIE', 'zurich': 'ZRH', 'geneva': 'GVA', 'brussels': 'BRU',
  'copenhagen': 'CPH', 'stockholm': 'STO', 'oslo': 'OSL', 'helsinki': 'HEL',
  'reykjavik': 'KEF', 'iceland': 'KEF',
  'athens': 'ATH', 'santorini': 'JTR', 'mykonos': 'JMK', 'rhodes': 'RHO',
  'crete': 'HER', 'heraklion': 'HER', 'corfu': 'CFU',
  'split': 'SPU', 'dubrovnik': 'DBV', 'zagreb': 'ZAG',
  'malta': 'MLA', 'larnaca': 'LCA', 'cyprus': 'LCA', 'paphos': 'PFO',
  'istanbul': 'IST', 'antalya': 'AYT', 'dalaman': 'DLM',
  'marrakech': 'RAK', 'agadir': 'AGA', 'casablanca': 'CMN',
  'cairo': 'CAI', 'hurghada': 'HRG', 'sharm': 'SSH',
  'new york': 'NYC', 'nyc': 'NYC', 'boston': 'BOS', 'miami': 'MIA',
  'orlando': 'MCO', 'los angeles': 'LAX', 'san francisco': 'SFO',
  'chicago': 'CHI', 'las vegas': 'LAS', 'washington': 'WAS',
  'toronto': 'YTO', 'vancouver': 'YVR', 'montreal': 'YMQ',
  'dubai': 'DXB', 'abu dhabi': 'AUH', 'doha': 'DOH',
  'bangkok': 'BKK', 'singapore': 'SIN', 'tokyo': 'TYO', 'hong kong': 'HKG',
  'bali': 'DPS', 'denpasar': 'DPS', 'phuket': 'HKT',
  'delhi': 'DEL', 'mumbai': 'BOM',
  'cape town': 'CPT', 'johannesburg': 'JNB', 'nairobi': 'NBO',
  'sydney': 'SYD', 'melbourne': 'MEL', 'perth': 'PER', 'auckland': 'AKL',
  'cancun': 'CUN', 'mexico city': 'MEX', 'rio': 'RIO', 'rio de janeiro': 'RIO',
  'sao paulo': 'SAO', 'buenos aires': 'BUE', 'lima': 'LIM', 'bogota': 'BOG',
  'santiago': 'SCL', 'havana': 'HAV',
};

function cityToIata(name) {
  const clean = String(name || '').toLowerCase().trim()
    .replace(/\s*\(.*\)\s*/g, '') // strip parentheticals: "London (all airports)"
    .replace(/\s+/g, ' ');
  if (CITY_IATA[clean]) return CITY_IATA[clean];
  // Try each word/leading phrase: "London Gatwick" → "gatwick", "New York City" → "new york"
  for (const key of Object.keys(CITY_IATA)) {
    if (clean.includes(key)) return CITY_IATA[key];
  }
  return null;
}

/**
 * Derive an affiliate-wrapped Aviasales search link from a deal's route text
 * ("Dublin → Lisbon"). Returns null when the destination can't be mapped —
 * callers treat null as "no fares link available", never an error.
 */
export function routeSearchUrl(route, region, marker) {
  const parts = String(route || '').split(/→|->/);
  if (parts.length < 2) return null;
  const origin = cityToIata(parts[0]) || (region === 'uk' ? 'LON' : 'DUB');
  const dest = cityToIata(parts[1]);
  if (!dest || dest === origin) return null;
  return buildSearchLink(origin, dest, marker);
}
