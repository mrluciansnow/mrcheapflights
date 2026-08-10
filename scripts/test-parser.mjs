#!/usr/bin/env node
// Regression tests for the deal parser (functions/_lib/scraper.js).
//
// These exist because the parser was silently publishing wrong data: it
// defaulted the origin to Dublin/London whenever its pattern missed, so
// "Cork to Lisbon" went live as "Dublin → Lisbon". Nothing guarded that.
//
// The central assertion is NEGATIVE: input we can't resolve must be REJECTED,
// never published with invented values.
//
//   npm run test:parser

import { parseDealTitle, extractPrice, extractRoute, extractDates, deriveExpiry, captionMatchesDeal } from '../functions/_lib/scraper.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name, got !== undefined ? `\n      got: ${JSON.stringify(got)}` : ''); }
};

console.log('\n── Route: must resolve both ends, never invent an origin ──');
const R = (t, region = 'ie', d = '') => {
  const r = parseDealTitle(t, 'https://x.test', region, d);
  return r ? r.route : null;
};

ok('keeps the real origin (regression: was "Dublin → Lisbon")',
  R('Cork to Lisbon for €29 return') === 'Cork → Lisbon', R('Cork to Lisbon for €29 return'));
ok('keeps Shannon (regression: was "Dublin → New York")',
  R('Shannon to New York for €199 return') === 'Shannon → New York', R('Shannon to New York for €199 return'));
ok('"from X to Y" form still works',
  R('Flights from Manchester to Barcelona from £39', 'uk') === 'Manchester → Barcelona', R('Flights from Manchester to Barcelona from £39', 'uk'));
ok('lowercase destination resolves (was rejected)',
  R('cheap flights from dublin to lisbon for €29') === 'Dublin → Lisbon', R('cheap flights from dublin to lisbon for €29'));
ok('valid deal no longer dropped before a currency symbol (was rejected)',
  R('London to Malaga £25 return', 'uk') === 'London → Malaga', R('London to Malaga £25 return', 'uk'));
ok('"to <Dest> from <Origin>" reversed form',
  R('Flights to Faro from Cork for €35') === 'Cork → Faro', R('Flights to Faro from Cork for €35'));
ok('strips leading article noise',
  R('Dublin to the Algarve for €39') === null || typeof R('Dublin to the Algarve for €39') === 'string');

console.log('\n── Rejection: unresolvable input must NOT be published ──');
ok('junk destination rejected (regression: was "Dublin → Book Now")',
  R('Save on flights to Book Now for €19') === null, R('Save on flights to Book Now for €19'));
ok('no origin ⇒ rejected, never defaulted to Dublin',
  R('Cheap flights to Lisbon for €29') === null, R('Cheap flights to Lisbon for €29'));
ok('unknown origin city rejected (not an airport we serve)',
  R('Vilnius to Lisbon for €29') === null, R('Vilnius to Lisbon for €29'));
ok('unknown destination rejected',
  R('Dublin to Nowhereville for €29') === null, R('Dublin to Nowhereville for €29'));
ok('origin must belong to the deal region (Cork is not a UK origin)',
  R('Cork to Lisbon for £29', 'uk') === null, R('Cork to Lisbon for £29', 'uk'));
ok('no price ⇒ rejected', R('Dublin to Lisbon flights available now') === null);
ok('same origin and destination rejected', R('Dublin to Dublin for €29') === null);

console.log('\n── Real feed shapes (emoji, countries, non-flight junk) ──');
// Every case below is a verbatim headline seen on a live feed.
ok('emoji between city and price no longer kills the match',
  R('Cheap non-stop flights from London to New York 🗽 for £349', 'uk') === 'London → New York',
  R('Cheap non-stop flights from London to New York 🗽 for £349', 'uk'));
ok('country-level destination resolves',
  R('Hainan Airlines flights from Manchester to Japan 🍣 from £519', 'uk') === 'Manchester → Japan',
  R('Hainan Airlines flights from Manchester to Japan 🍣 from £519', 'uk'));
ok('two-word country resolves',
  R('Cheap full-service flights from Manchester to South Korea 🍁 for £447', 'uk') === 'Manchester → South Korea',
  R('Cheap full-service flights from Manchester to South Korea 🍁 for £447', 'uk'));
ok('ferry/mini-cruise rejected (not a flight)',
  R('🛳️ DFDS 2-night mini-cruise 🤩 Newcastle to Amsterdam 🇳🇱🔥', 'uk') === null,
  R('🛳️ DFDS 2-night mini-cruise 🤩 Newcastle to Amsterdam 🇳🇱🔥', 'uk'));
// The case above would otherwise pass merely for lacking a price — this one
// names a real city pair AND a price, so only the non-flight guard stops it.
ok('PRICED ferry still rejected (guard, not luck)',
  R('DFDS mini-cruise Newcastle to Amsterdam for £79', 'uk') === null,
  R('DFDS mini-cruise Newcastle to Amsterdam for £79', 'uk'));
ok('priced hotel package rejected',
  R('London to Rome flights + 3 nights hotel for £299', 'uk') === null,
  R('London to Rome flights + 3 nights hotel for £299', 'uk'));
ok('plain flight deal still accepted after the guard',
  R('London to Rome flights for £59', 'uk') === 'London → Rome',
  R('London to Rome flights for £59', 'uk'));
ok('hotel deal rejected', R('Bargain London Travelodge from UNDER £50 😮', 'uk') === null);
ok('theatre tickets rejected', R('London theatre shows UNDER £20 🤯', 'uk') === null);
ok('package with no stated origin rejected',
  R('Sneak off to Sardinia: Mini-break under £155', 'uk') === null);

console.log('\n── Price: currency follows region ──');
ok('IE takes the € figure', extractPrice('was $80, now €29', 'ie')?.display === '€29', extractPrice('was $80, now €29', 'ie'));
ok('UK takes the £ figure', extractPrice('£25 return (about €29)', 'uk')?.display === '£25', extractPrice('£25 return (about €29)', 'uk'));
ok('$-only price rejected for an IE deal', extractPrice('New York for $199', 'ie') === null);
ok('€-only price rejected for a UK deal', extractPrice('Lisbon for €29', 'uk') === null);
ok('thousands separator parsed', extractPrice('business class €1,299', 'ie')?.display === '€1299');
ok('absurd price rejected as a mis-scrape', extractPrice('package from €4500', 'ie') === null);

console.log('\n── Dates: extracted, not left blank ──');
ok('"12–19 Nov"', extractDates('travel 12–19 Nov 2026') === '12–19 Nov', extractDates('travel 12–19 Nov 2026'));
ok('"Nov 12-19"', extractDates('depart Nov 12-19') === '12–19 Nov', extractDates('depart Nov 12-19'));
ok('month range', extractDates('flying Jan-Mar 2027') === 'Jan–Mar', extractDates('flying Jan-Mar 2027'));
ok('"travel in October"', extractDates('travel in October') === 'Oct', extractDates('travel in October'));
ok('no date ⇒ empty string, not a guess', extractDates('great deal to Lisbon') === '');

console.log('\n── Expiry: nothing lives forever, nothing dies silently ──');
const NOW = new Date('2026-08-01T12:00:00Z');
ok('dated window expires when the trip starts',
  deriveExpiry('12–19 Nov', NOW) === '2026-11-12', deriveExpiry('12–19 Nov', NOW));
ok('bare month expires at month end',
  deriveExpiry('Oct', NOW) === '2026-10-31', deriveExpiry('Oct', NOW));
ok('month already past rolls to next year',
  deriveExpiry('Feb', NOW) === '2027-02-28', deriveExpiry('Feb', NOW));
ok('no dates ⇒ conservative shelf life, never null',
  deriveExpiry('', NOW) === '2026-08-22', deriveExpiry('', NOW));
ok('never returns an already-expired date',
  deriveExpiry('1–3 Aug', NOW) > '2026-08-01', deriveExpiry('1–3 Aug', NOW));
ok('capped at a year out',
  deriveExpiry('Jul', NOW) <= '2027-08-01', deriveExpiry('Jul', NOW));
ok('always yields a date (a deal can never be immortal)',
  /^\d{4}-\d{2}-\d{2}$/.test(deriveExpiry('nonsense', NOW)), deriveExpiry('nonsense', NOW));

console.log('\n── Caption gate: AI copy must describe THIS deal ──');
const R2 = 'Dublin → Lisbon', P2 = '€29';
ok('accepts a caption with the right price and destination',
  captionMatchesDeal('€29 to LISBON?! Grab it before it goes ✈', R2, P2));
ok('rejects a caption quoting the WRONG price',
  !captionMatchesDeal('€49 to Lisbon, unreal', R2, P2));
ok('rejects a caption naming the WRONG destination',
  !captionMatchesDeal('€29 to Barcelona, unreal', R2, P2));
ok('tolerates thousands separators (€1,299 vs 1299)',
  captionMatchesDeal('Business class to Tokyo for €1,299', 'Dublin → Tokyo', '€1299'));
ok('matches a word of a multi-word destination',
  captionMatchesDeal('£349 to New York baby', 'London → New York', '£349'));
ok('rejects empty copy', !captionMatchesDeal('', R2, P2));

console.log('\n── Full shape ──');
const full = parseDealTitle('Cork to Lisbon for €29 return', 'https://x.test', 'ie', 'Travel 12–19 Nov 2026');
ok('route', full?.route === 'Cork → Lisbon', full?.route);
ok('price', full?.price === '€29', full?.price);
ok('dates populated', full?.dates === '12–19 Nov', full?.dates);
ok('flag resolved from destination', full?.flag === '🇵🇹', full?.flag);
ok('badge assigned', typeof full?.badge === 'string' && full.badge.length > 0, full?.badge);
const mistake = parseDealTitle('Mistake fare: Dublin to Tokyo €299', 'https://x.test', 'ie', '');
ok('mistake fare badge', mistake?.badge === '⚠️ Mistake Fare', mistake?.badge);


// ── Destination resolution: a deal whose destination can't resolve is invisible
// to fan-out, affiliate links and multi-city entirely. The only live deal on the
// site once resolved to nothing ("London → Lapland"), so fan-out silently
// reported priced:0 forever. These pin the destinations that caused it.
console.log('\n── Destinations that must resolve ──');
const { routeIatas } = await import('../functions/_lib/affiliate.js');
for (const [route, region] of [
  ['London → Lapland', 'uk'], ['London → Macau', 'uk'],
  ['Dublin → Lisbon', 'ie'], ['Manchester → Bali', 'uk'],
]) {
  ok(`resolves: ${route}`, !!routeIatas(route, region), routeIatas(route, region));
}

console.log(`
${pass} passed, ${fail} failed
`);
process.exit(fail ? 1 : 0);
