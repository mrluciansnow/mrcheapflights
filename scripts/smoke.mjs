#!/usr/bin/env node
// Public prod smoke test — no secrets, no auth. Exercises the endpoints a
// real visitor hits and asserts the load-bearing invariants (site up, deals
// API healthy, guests never receive gated fare data, trust-copy fixes stayed
// fixed). Exits non-zero on any failure so CI fails the push.
//
//   BASE_URL=https://mrcheapflights.ie node scripts/smoke.mjs
// Defaults to the .ie production domain.

const BASE = (process.env.BASE_URL || 'https://mrcheapflights.ie').replace(/\/$/, '');
const results = [];
let failed = 0;

function check(name, cond, detail = '') {
  const ok = !!cond;
  results.push({ name, ok, detail });
  if (!ok) failed++;
  // detail is diagnostic — only surface it when the check actually failed.
  console.log(`${ok ? '✅' : '❌'} ${name}${!ok && detail ? ' — ' + detail : ''}`);
}

async function get(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'follow', ...opts });
  const text = await res.text();
  return { status: res.status, text, res };
}

async function run() {
  console.log(`\n🔎 Smoke test against ${BASE}\n`);

  // 1. Homepage up + trust-copy invariants (Stage 1 must not regress)
  {
    const { status, text } = await get('/');
    check('homepage 200', status === 200, `status ${status}`);
    check('homepage: no "12,400" fabrication', !text.includes('12,400'));
    check('homepage: no "never take commission"', !/never take commission/i.test(text));
    check('homepage: affiliate disclosure present', /affiliate links/i.test(text));
  }

  // 2. Health probe
  {
    const { status, text } = await get('/api/health');
    let j = {}; try { j = JSON.parse(text); } catch {}
    check('/api/health ok', status === 200 && j.ok === true && j.db === true, `status ${status}, ok=${j.ok}, db=${j.db}`);
  }

  // 3. Deals API + guest fare-gating (SECURITY: guests must not get fare data)
  let firstSlug = null;
  {
    const { status, text } = await get('/api/deals?region=ie');
    let deals = []; try { deals = JSON.parse(text); } catch {}
    check('/api/deals 200 + array', status === 200 && Array.isArray(deals), `status ${status}`);
    check('guest gets NO fare details (fare object withheld)', deals.every((d) => !('fare' in d)),
      'a deal leaked a fare object to an unauthenticated caller');
    check('guest deals carry fare_gate', deals.length === 0 || deals.every((d) => 'fare_gate' in d));
    const withSlug = deals.find((d) => d.slug);
    firstSlug = withSlug ? withSlug.slug : null;
  }

  // 4. Server-rendered deal landing page (if any live deal exists)
  if (firstSlug) {
    const { status } = await get('/deals/' + encodeURIComponent(firstSlug));
    check('deal landing page 200', status === 200, `/deals/${firstSlug} → ${status}`);
  } else {
    console.log('ℹ️  no live deal with a slug — skipping deal-page check');
  }

  // 5. SEO surfaces
  for (const [path, needle] of [
    ['/sitemap.xml', '<urlset'],
    ['/robots.txt', 'Sitemap'],
    ['/flights-to', 'flights-to'],
    ['/flights-to/lisbon', 'Lisbon'],
    ['/terms.html', 'Terms of Service'],
    ['/privacy.html', 'Privacy'],
  ]) {
    const { status, text } = await get(path);
    check(`${path} 200 + content`, status === 200 && text.includes(needle), `status ${status}`);
  }

  // 6. Booking-intent redirect resolves server-side (never an open redirect)
  {
    const res = await fetch(BASE + '/api/go?dest=lisbon&kind=fares', { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    check('/api/go 302 to a resolved fare target', (res.status === 302 || res.status === 301) && /aviasales|tp\.media|google\.com/.test(loc),
      `status ${res.status}, location ${loc.slice(0, 60)}`);
  }

  // 7. Custom 404
  {
    const { status } = await get('/this-path-does-not-exist-xyz');
    check('unknown path → 404', status === 404, `status ${status}`);
  }

  console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`} (${results.length} checks)\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => { console.error('💥 smoke test crashed:', e.message); process.exit(1); });
