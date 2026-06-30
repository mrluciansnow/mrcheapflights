// Public RSS 2.0 feed — /feed?region=ie|uk
// Lists the 20 most recent non-expired deals for the requested region.
export async function onRequestGet(context) {
  const region = new URL(context.request.url).searchParams.get('region') || 'ie';
  const siteUrl = region === 'uk' ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const siteTitle = region === 'uk' ? 'Mr Cheap Flights UK' : 'Mr Cheap Flights Ireland';

  let deals = [];
  try {
    const rows = await context.env.DB.prepare(
      `SELECT flag, route, dates, price, badge, url, expiry, slug, created_at
       FROM deals
       WHERE region = ?
         AND (expiry IS NULL OR expiry >= date('now'))
       ORDER BY created_at DESC
       LIMIT 20`
    ).bind(region).all();
    deals = rows.results || [];
  } catch {
    // DB not available — return empty feed rather than 500
  }

  const now = new Date().toUTCString();

  const items = deals.map(function (d) {
    const link = d.slug
      ? `${siteUrl}/deals/${d.slug}`
      : (d.url || siteUrl);
    const safeRoute = escXml(d.route || '');
    const safePrice = escXml(d.price || '');
    const safeBadge = escXml(d.badge || '');
    const safeDates = escXml(d.dates || '');
    const pubDate = d.created_at ? new Date(d.created_at).toUTCString() : now;
    return `
    <item>
      <title>${escXml(d.flag || '')} ${safeRoute} — ${safePrice}</title>
      <link>${escXml(link)}</link>
      <guid isPermaLink="false">${escXml(link)}</guid>
      <description>${safeBadge}${safeDates ? ' · ' + safeDates : ''}</description>
      <pubDate>${pubDate}</pubDate>
    </item>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(siteTitle)}</title>
    <link>${escXml(siteUrl)}</link>
    <description>Cheap flight deals from ${region === 'uk' ? 'UK' : 'Irish'} airports — updated daily.</description>
    <language>${region === 'uk' ? 'en-gb' : 'en-ie'}</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${escXml(siteUrl)}/feed?region=${region}" rel="self" type="application/rss+xml"/>
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
