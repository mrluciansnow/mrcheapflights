// Departure-airport registry for the /flights-from/<origin> SEO hubs — the
// mirror of the /flights-to/<destination> hubs. Targets "cheap flights from
// Dublin/Cork/London…" queries. Region-scoped: .ie shows Irish origins, .co.uk
// shows UK origins (a page renders on both, but its deals are region-filtered).

export const ORIGINS = {
  // ── Ireland ──
  dublin:     { name: 'Dublin', region: 'ie', iata: 'DUB', country: 'Ireland' },
  cork:       { name: 'Cork', region: 'ie', iata: 'ORK', country: 'Ireland' },
  shannon:    { name: 'Shannon', region: 'ie', iata: 'SNN', country: 'Ireland' },
  belfast:    { name: 'Belfast', region: 'ie', iata: 'BFS', country: 'Ireland' },
  knock:      { name: 'Knock', region: 'ie', iata: 'NOC', country: 'Ireland' },
  // ── United Kingdom ──
  london:     { name: 'London', region: 'uk', iata: 'LON', country: 'the UK' },
  manchester: { name: 'Manchester', region: 'uk', iata: 'MAN', country: 'the UK' },
  birmingham: { name: 'Birmingham', region: 'uk', iata: 'BHX', country: 'the UK' },
  edinburgh:  { name: 'Edinburgh', region: 'uk', iata: 'EDI', country: 'the UK' },
  glasgow:    { name: 'Glasgow', region: 'uk', iata: 'GLA', country: 'the UK' },
  bristol:    { name: 'Bristol', region: 'uk', iata: 'BRS', country: 'the UK' },
};

export function getOrigin(slug) {
  return ORIGINS[String(slug || '').toLowerCase()] || null;
}

export function originsForRegion(region) {
  return Object.entries(ORIGINS)
    .filter(([, o]) => o.region === region)
    .map(([slug, o]) => ({ slug, ...o }));
}

// The origin (departure) slug for a deal's route text ("Dublin → Lisbon"
// → "dublin"). Returns null when the departure city isn't a known origin.
export function originSlugForRoute(route) {
  const dep = String(route || '').split(/→|->/)[0] || '';
  const clean = dep.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  for (const slug of Object.keys(ORIGINS)) {
    if (clean.includes(slug)) return slug;
  }
  return null;
}
