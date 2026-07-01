// Dynamic XML sitemap at /sitemap.xml
// Lists the homepage + all non-expired deals as /deals/:slug
export async function onRequestGet(context) {
  const host = new URL(context.request.url).hostname;
  const isUk = host.includes('co.uk');
  const region = isUk ? 'uk' : 'ie';
  const base = isUk ? 'https://mrcheapflights.co.uk' : 'https://mrcheapflights.ie';
  const now = new Date().toISOString().slice(0, 10);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  let dealUrls = '';
  try {
    const rows = await context.env.DB.prepare(
      `SELECT slug, route, price, updated_at, created_at
       FROM deals
       WHERE region = ?
         AND status = 'live'
         AND slug IS NOT NULL
         AND slug != ''
         AND (expiry IS NULL OR expiry >= date('now'))
       ORDER BY created_at DESC`
    ).bind(region).all();

    dealUrls = (rows.results || []).map(function (d) {
      const lastmod = d.updated_at
        ? new Date(d.updated_at * 1000).toISOString().slice(0, 10)
        : now;
      const createdDate = d.created_at
        ? new Date(d.created_at * 1000).toISOString().slice(0, 10)
        : now;
      const priority = createdDate >= sevenDaysAgo ? '0.8' : '0.6';
      return `
  <url>
    <loc>${base}/deals/${escXml(d.slug)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${priority}</priority>
  </url>`;
    }).join('');
  } catch { /* DB unavailable — serve static-only sitemap */ }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>${dealUrls}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
