#!/usr/bin/env node
// Tests for newsletter parsing (functions/_lib/email-deals.js).
//
// Newsletters are the highest-value deal source (Jack's Flight Club, Secret
// Flying — the latter hard-blocks Worker IPs, so email is the only way in) and
// they carry SEVERAL deals per message, often one destination from MANY
// departure cities. Both behaviours are pinned here.
//
//   npm run test:email

import { parseNewsletter, extractOriginPrices, htmlToText } from '../functions/_lib/email-deals.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name, got !== undefined ? `\n      got: ${JSON.stringify(got)}` : ''); }
};

console.log('\n── HTML → text ──');
ok('strips tags and scripts',
  !/[<>]/.test(htmlToText('<div><script>bad()</script><p>Dublin to Lisbon</p></div>')));
ok('keeps line structure', htmlToText('<p>one</p><p>two</p>').includes('\n'));
ok('decodes entities', htmlToText('<p>B&amp;B &#8211; deal</p>').includes('&'));

console.log('\n── Multi-origin lines (what makes the carousel possible) ──');
const multi = extractOriginPrices('London £229 · Manchester £249 · Edinburgh £239', 'uk');
ok('parses three departure cities', multi.length === 3, multi.map((m) => m.city));
ok('keeps each city price', multi[0].price === 229 && multi[1].price === 249, multi);
ok('resolves IATA', multi[0].iata === 'LON', multi[0]);
ok('single city is NOT a multi-origin list', extractOriginPrices('London £229 return', 'uk').length === 0);
ok('ignores cities we do not depart from',
  extractOriginPrices('Vienna €199 · Prague €210', 'uk').length === 0);
ok('IE list resolves', extractOriginPrices('Dublin €279 · Cork €299', 'ie').length === 2);

console.log('\n── Whole newsletter ──');
const email = {
  subject: "Jack's Flight Club: Dublin to Lisbon for €29",
  html: `<html><body>
    <h1>This week's best fares</h1>
    <p>Dublin to Lisbon for €29 return — travel 12–19 Nov</p>
    <p>Book here: https://jacksflightclub.com/deal/lisbon-29</p>
    <p>Cork to Faro for €39 return, travel in October</p>
    <p>5-star all-inclusive Zante holiday with the family for €899</p>
    <p>DFDS mini-cruise Dublin to Cherbourg for €120</p>
  </body></html>`,
};
const deals = parseNewsletter({ ...email, region: 'ie' });
const routes = deals.map((d) => d.route);
ok('finds several deals in one email', deals.length >= 2, routes);
ok('parses Dublin → Lisbon', routes.includes('Dublin → Lisbon'), routes);
ok('parses Cork → Faro (real origin kept)', routes.includes('Cork → Faro'), routes);
ok('rejects the all-inclusive package', !routes.some((r) => /Zante/.test(r)), routes);
ok('rejects the mini-cruise', !routes.some((r) => /Cherbourg/.test(r)), routes);
ok('captures the booking link', deals[0].url && deals[0].url.startsWith('https://'), deals[0].url);
ok('carries dates through', deals.some((d) => d.dates), deals.map((d) => d.dates));
ok('no duplicate routes', new Set(routes).size === routes.length, routes);

console.log('\n── Multi-origin newsletter → one deal, many origins ──');
const mo = parseNewsletter({
  subject: 'Cheap flights to New York',
  html: `<p>London to New York for £229 return</p>
         <p>Also available: London £229 · Manchester £249 · Edinburgh £239</p>`,
  region: 'uk',
});
const nyc = mo.find((d) => /New York/.test(d.route));
ok('deal found', !!nyc, mo.map((d) => d.route));
ok('origins attached', nyc && nyc.origins.length === 3, nyc && nyc.origins.map((o) => o.city));
ok('cheapest origin present', nyc && nyc.origins.some((o) => o.price === 229), nyc && nyc.origins);

console.log('\n── Origins must belong to THIS deal ──');
// Regression: every deal in an email used to inherit whichever city/price list
// appeared first, so "Dublin to Lisbon €29" was given origins of €279/€299 —
// numbers belonging to a different deal further down the newsletter.
const mixed = parseNewsletter({
  subject: 'This weeks fares',
  html: `<p>Dublin to Lisbon for €29 return</p>
         <p>Cork to Faro for €39 return</p>
         <p>Also from: Dublin €279 · Cork €299</p>`,
  region: 'ie',
});
ok('unrelated city/price list is NOT attached',
  mixed.every((d) => d.origins.length === 0), mixed.map((d) => ({ r: d.route, o: d.origins.length })));
const matched = parseNewsletter({
  subject: 'x',
  html: `<p>London to New York for £229 return</p>
         <p>London £229 · Manchester £249</p>`,
  region: 'uk',
});
ok('list containing the deal price IS attached',
  matched[0] && matched[0].origins.length === 2, matched[0] && matched[0].origins.map((o) => o.city));

console.log('\n── Nothing invented ──');
const junk = parseNewsletter({
  subject: 'Our newsletter',
  html: '<p>Great hotel offers this week! Book now for under £50.</p>',
  region: 'uk',
});
ok('no deals from a non-deal email', junk.length === 0, junk.map((d) => d.route));
const noOrigin = parseNewsletter({ subject: 'x', html: '<p>Flights to Lisbon for €29</p>', region: 'ie' });
ok('origin-less line is not given a default origin',
  !noOrigin.some((d) => /Dublin/.test(d.route)), noOrigin.map((d) => d.route));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
