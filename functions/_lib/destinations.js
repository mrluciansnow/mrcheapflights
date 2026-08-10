// Canonical destination registry — the backbone of the programmatic-SEO
// growth engine. Each entry drives an evergreen /flights-to/:slug hub page.
//
// Static metadata lives here (version-controlled, easy to curate); the
// expensive AI-written guide + hero image are generated once and cached in
// the `destination_content` D1 table (migration 0012), the same pattern as
// deal images.
//
// Curated to the ~40 highest-search-volume destinations from IE/UK airports.
// `landmark` grounds the AI guide + image prompt so pages feel specific.

export const DESTINATIONS = {
  // ── City breaks ──────────────────────────────────────────────────────────
  lisbon:     { name: 'Lisbon',     country: 'Portugal', flag: '🇵🇹', iata: 'LIS', type: 'city',      landmark: 'Alfama rooftops and the 25 de Abril bridge' },
  porto:      { name: 'Porto',      country: 'Portugal', flag: '🇵🇹', iata: 'OPO', type: 'city',      landmark: 'the Ribeira riverfront and Dom Luís bridge' },
  barcelona:  { name: 'Barcelona',  country: 'Spain',    flag: '🇪🇸', iata: 'BCN', type: 'city',      landmark: 'the Sagrada Família and Gothic Quarter' },
  madrid:     { name: 'Madrid',     country: 'Spain',    flag: '🇪🇸', iata: 'MAD', type: 'city',      landmark: 'Gran Vía and the Retiro park' },
  rome:       { name: 'Rome',       country: 'Italy',    flag: '🇮🇹', iata: 'ROM', type: 'city',      landmark: 'the Colosseum and terracotta rooftops' },
  milan:      { name: 'Milan',      country: 'Italy',    flag: '🇮🇹', iata: 'MIL', type: 'city',      landmark: 'the Duomo and Galleria' },
  venice:     { name: 'Venice',     country: 'Italy',    flag: '🇮🇹', iata: 'VCE', type: 'city',      landmark: 'the Grand Canal and St Mark’s Square' },
  amsterdam:  { name: 'Amsterdam',  country: 'Netherlands', flag: '🇳🇱', iata: 'AMS', type: 'city',   landmark: 'the canal houses and bridges' },
  paris:      { name: 'Paris',      country: 'France',   flag: '🇫🇷', iata: 'PAR', type: 'city',      landmark: 'the Eiffel Tower and Montmartre' },
  berlin:     { name: 'Berlin',     country: 'Germany',  flag: '🇩🇪', iata: 'BER', type: 'city',      landmark: 'the Brandenburg Gate' },
  prague:     { name: 'Prague',     country: 'Czechia',  flag: '🇨🇿', iata: 'PRG', type: 'city',      landmark: 'Charles Bridge and the castle' },
  budapest:   { name: 'Budapest',   country: 'Hungary',  flag: '🇭🇺', iata: 'BUD', type: 'city',      landmark: 'Parliament on the Danube and the thermal baths' },
  krakow:     { name: 'Kraków',     country: 'Poland',   flag: '🇵🇱', iata: 'KRK', type: 'city',      landmark: 'the medieval Old Town square' },
  vienna:     { name: 'Vienna',     country: 'Austria',  flag: '🇦🇹', iata: 'VIE', type: 'city',      landmark: 'Schönbrunn Palace and the Ringstrasse' },
  athens:     { name: 'Athens',     country: 'Greece',   flag: '🇬🇷', iata: 'ATH', type: 'city',      landmark: 'the Acropolis' },
  copenhagen: { name: 'Copenhagen', country: 'Denmark',  flag: '🇩🇰', iata: 'CPH', type: 'city',      landmark: 'Nyhavn’s coloured harbour houses' },
  reykjavik:  { name: 'Reykjavik',  country: 'Iceland',  flag: '🇮🇸', iata: 'KEF', type: 'city',      landmark: 'Hallgrímskirkja and the northern lights' },
  istanbul:   { name: 'Istanbul',   country: 'Turkey',   flag: '🇹🇷', iata: 'IST', type: 'city',      landmark: 'the Hagia Sophia and Bosphorus' },
  edinburgh:  { name: 'Edinburgh',  country: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', iata: 'EDI', type: 'city',    landmark: 'the castle above the Royal Mile' },

  // ── Sun & beach ──────────────────────────────────────────────────────────
  malaga:     { name: 'Malaga',     country: 'Spain',    flag: '🇪🇸', iata: 'AGP', type: 'sun',       landmark: 'the Costa del Sol beaches and old town' },
  alicante:   { name: 'Alicante',   country: 'Spain',    flag: '🇪🇸', iata: 'ALC', type: 'sun',       landmark: 'Santa Bárbara castle above the marina' },
  palma:      { name: 'Palma',      country: 'Spain',    flag: '🇪🇸', iata: 'PMI', type: 'sun',       landmark: 'Palma Cathedral over the bay of Mallorca' },
  ibiza:      { name: 'Ibiza',      country: 'Spain',    flag: '🇪🇸', iata: 'IBZ', type: 'sun',       landmark: 'Dalt Vila above a turquoise cove' },
  faro:       { name: 'Faro',       country: 'Portugal', flag: '🇵🇹', iata: 'FAO', type: 'sun',       landmark: 'the Algarve’s golden cliffs and beaches' },
  nice:       { name: 'Nice',       country: 'France',   flag: '🇫🇷', iata: 'NCE', type: 'sun',       landmark: 'the Promenade des Anglais and azure sea' },
  split:      { name: 'Split',      country: 'Croatia',  flag: '🇭🇷', iata: 'SPU', type: 'sun',       landmark: 'Diocletian’s Palace on the Adriatic' },
  dubrovnik:  { name: 'Dubrovnik',  country: 'Croatia',  flag: '🇭🇷', iata: 'DBV', type: 'sun',       landmark: 'the walled old town above the sea' },
  santorini:  { name: 'Santorini',  country: 'Greece',   flag: '🇬🇷', iata: 'JTR', type: 'sun',       landmark: 'white-and-blue cliffside houses' },
  crete:      { name: 'Crete',      country: 'Greece',   flag: '🇬🇷', iata: 'HER', type: 'sun',       landmark: 'the Balos lagoon and Venetian harbour' },
  malta:      { name: 'Malta',      country: 'Malta',    flag: '🇲🇹', iata: 'MLA', type: 'sun',       landmark: 'Valletta’s harbour bastions' },
  antalya:    { name: 'Antalya',    country: 'Turkey',   flag: '🇹🇷', iata: 'AYT', type: 'sun',       landmark: 'the turquoise coast and old harbour' },
  larnaca:    { name: 'Larnaca',    country: 'Cyprus',   flag: '🇨🇾', iata: 'LCA', type: 'sun',       landmark: 'the palm-lined seafront' },

  // ── Winter sun ───────────────────────────────────────────────────────────
  tenerife:   { name: 'Tenerife',      country: 'Canary Islands', flag: '🇮🇨', iata: 'TFS', type: 'wintersun', landmark: 'Mount Teide above the clouds' },
  lanzarote:  { name: 'Lanzarote',     country: 'Canary Islands', flag: '🇮🇨', iata: 'ACE', type: 'wintersun', landmark: 'the volcanic Timanfaya landscape' },
  'gran-canaria': { name: 'Gran Canaria', country: 'Canary Islands', flag: '🇮🇨', iata: 'LPA', type: 'wintersun', landmark: 'the Maspalomas dunes' },
  fuerteventura: { name: 'Fuerteventura', country: 'Canary Islands', flag: '🇮🇨', iata: 'FUE', type: 'wintersun', landmark: 'endless white-sand beaches' },
  marrakech:  { name: 'Marrakech',  country: 'Morocco', flag: '🇲🇦', iata: 'RAK', type: 'wintersun', landmark: 'the medina and Koutoubia minaret' },
  madeira:    { name: 'Madeira',    country: 'Portugal', flag: '🇵🇹', iata: 'FNC', type: 'wintersun', landmark: 'the clifftop levada trails above Funchal' },
  dubai:      { name: 'Dubai',      country: 'UAE',     flag: '🇦🇪', iata: 'DXB', type: 'wintersun', landmark: 'the Burj Khalifa above the marina' },

  // ── Long haul ────────────────────────────────────────────────────────────
  'new-york': { name: 'New York',   country: 'USA',     flag: '🇺🇸', iata: 'NYC', type: 'longhaul',  landmark: 'the Manhattan skyline and Brooklyn Bridge' },
  boston:     { name: 'Boston',     country: 'USA',     flag: '🇺🇸', iata: 'BOS', type: 'longhaul',  landmark: 'the brownstones and harbour' },
  miami:      { name: 'Miami',      country: 'USA',     flag: '🇺🇸', iata: 'MIA', type: 'longhaul',  landmark: 'Ocean Drive’s art-deco neon and South Beach' },
  orlando:    { name: 'Orlando',    country: 'USA',     flag: '🇺🇸', iata: 'MCO', type: 'longhaul',  landmark: 'the theme parks and palm-lined lakes' },
  'los-angeles': { name: 'Los Angeles', country: 'USA', flag: '🇺🇸', iata: 'LAX', type: 'longhaul', landmark: 'the Hollywood hills and palm-lined boulevards' },
  toronto:    { name: 'Toronto',    country: 'Canada',  flag: '🇨🇦', iata: 'YTO', type: 'longhaul',  landmark: 'the CN Tower skyline' },
  bangkok:    { name: 'Bangkok',    country: 'Thailand', flag: '🇹🇭', iata: 'BKK', type: 'longhaul', landmark: 'the temples and floating markets' },
  singapore:  { name: 'Singapore',  country: 'Singapore', flag: '🇸🇬', iata: 'SIN', type: 'longhaul', landmark: 'Marina Bay Sands and the supertrees' },
  tokyo:      { name: 'Tokyo',      country: 'Japan',   flag: '🇯🇵', iata: 'TYO', type: 'longhaul',  landmark: 'Shibuya’s neon and Mount Fuji on the horizon' },
  bali:       { name: 'Bali',       country: 'Indonesia', flag: '🇮🇩', iata: 'DPS', type: 'longhaul', landmark: 'the rice terraces and temple gates' },
};

const TYPE_LABEL = {
  sun: 'Sun & Beach', wintersun: 'Winter Sun', city: 'City Breaks', longhaul: 'Long Haul',
};

export function getDestination(slug) {
  const s = String(slug || '').toLowerCase();
  return DESTINATIONS[s] ? { slug: s, ...DESTINATIONS[s] } : null;
}

export function allDestinations() {
  return Object.keys(DESTINATIONS).map((slug) => ({ slug, ...DESTINATIONS[slug] }));
}

// Grouped by type for the hub index, in display order.
export function destinationsByType() {
  const order = ['city', 'sun', 'wintersun', 'longhaul'];
  return order.map((type) => ({
    type,
    label: TYPE_LABEL[type],
    items: allDestinations().filter((d) => d.type === type).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

// Map a free-text deal route destination (e.g. "London → Barcelona") to a
// registry slug, so deal pages can link to their destination hub and hubs can
// pull matching live deals. Returns slug or null.
export function destSlugForText(text) {
  const clean = String(text || '').toLowerCase();
  // Longest names first so "new york" wins over a stray "york"
  const slugs = Object.keys(DESTINATIONS).sort((a, b) => DESTINATIONS[b].name.length - DESTINATIONS[a].name.length);
  for (const slug of slugs) {
    const name = DESTINATIONS[slug].name.toLowerCase();
    if (clean.includes(name) || clean.includes(slug.replace(/-/g, ' '))) return slug;
  }
  return null;
}
