// Public RSS 2.0 feed — /feed?region=ie|uk
// Lists the 20 most recent non-expired deals for the requested region.
export async function onRequestGet(context) {
  const rawRegion = new URL(context.request.url).searchParams.get('region') || 'ie';
  const region = ['ie', 'uk'].includes(rawRegion) ? rawRegion : 'ie';
  const siteUrl = region === 'uk' ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const siteTitle = region === 'uk' ? 'Mr Cheap Flights UK' : 'Mr Cheap Flights Ireland';

  let deals = [];
  try {
    const rows = await context.env.DB.prepare(
      `SELECT flag, route, dates, price, badge, url, expiry, slug, created_at, was_price, airline
       FROM deals
       WHERE region = ?
         AND status = 'live'
         AND (expiry IS NULL OR expiry >= date('now'))
       ORDER BY created_at DESC
       LIMIT 20`
    ).bind(region).all();
    deals = rows.results || [];
  } catch {
    // DB not available — return empty feed rather than 500
  }

  const now = new Date().toUTCString();
  const currency = region === 'uk' ? '£' : '€';

  const items = deals.map(function (d) {
    const link = d.slug
      ? `${siteUrl}/deals/${d.slug}`
      : (d.url || siteUrl);
    const safeRoute = escXml(d.route || '');
    const safePrice = escXml(d.price || '');
    const safeBadge = escXml(d.badge || '');
    const safeDates = escXml(d.dates || '');
    const pubDate = d.created_at ? new Date(d.created_at * 1000).toUTCString() : now;

    const expiryNote = d.expiry ? ` · Book by ${d.expiry}` : '';
    const wasNote = d.was_price ? ` (was ${d.was_price})` : '';
    const airlineNote = d.airline ? ` with ${d.airline}` : '';
    const description = `${safeBadge} — ${safeRoute}${airlineNote} from just ${safePrice}${wasNote}. ${safeDates}${expiryNote}. Book directly with the airline — no commission.`;

    return `
    <item>
      <title>${escXml(d.flag || '✈️')} ${safeRoute} — from ${safePrice} return</title>
      <link>${escXml(link)}</link>
      <guid isPermaLink="true">${escXml(link)}</guid>
      <description><![CDATA[${description}]]></description>
      <category>${safeBadge}</category>
      <pubDate>${pubDate}</pubDate>
      <author>hello@mrcheapflights.ie (Mr Cheap Flights)</author>
    </item>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(siteTitle)}</title>
    <link>${escXml(siteUrl)}</link>
    <description>The best cheap flight deals from ${region === 'uk' ? 'UK' : 'Irish'} airports — hand-picked and updated daily. No commission, book direct.</description>
    <language>${region === 'uk' ? 'en-gb' : 'en-ie'}</language>
    <managingEditor>hello@mrcheapflights.ie (Mr Cheap Flights)</managingEditor>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${escXml(siteUrl)}/feed?region=${region}" rel="self" type="application/rss+xml"/>
    <image>
      <url>${escXml(siteUrl)}/mascot.png</url>
      <title>${escXml(siteTitle)}</title>
      <link>${escXml(siteUrl)}</link>
    </image>
    <ttl>60</ttl>${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
