// Global middleware — runs on every request to the Pages project.
//
// Two responsibilities:
//  1. mrcheap.flights gateway — server-side geo-detect + redirect to the
//     right regional site before the page loads. IE visitors go to
//     mrcheapflights.ie, GB visitors to mrcheapflights.co.uk, everyone
//     else sees the directory.html country picker.
//  2. Security headers on every response.

const STATIC_EXT = /\.(png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|eot|txt|xml|pdf|mp4|webm|avif)$/i;

// Content-Security-Policy covering all external resources used on site:
// GA4 (googletagmanager + google-analytics), Google Fonts, Cloudflare email
// obfuscation script (same origin), and the Stripe redirect flow (no client JS).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://analytics.google.com https://www.google-analytics.com https://region1.google-analytics.com https://region1.analytics.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function applySecurityHeaders(headers, pathname) {
  headers.set('Content-Security-Policy', CSP);
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Prevents opener access across origins (Spectre / cross-origin leak protection).
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // Prevents other origins from loading our resources (images, scripts) directly.
  headers.set('Cross-Origin-Resource-Policy', 'same-site');
  if (pathname.startsWith('/api/admin')) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
}

export async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);
  const host = url.hostname;

  // ── mrcheap.flights gateway ───────────────────────────────────────────────
  // Only intercept the gateway domain — .ie and .co.uk flow straight through.
  if (host === 'mrcheap.flights' || host === 'www.mrcheap.flights') {
    const path = url.pathname;
    const override = url.searchParams.get('override') === '1';

    // Static assets on the gateway domain are served as-is (mascot, fonts…).
    if (STATIC_EXT.test(path)) {
      const res = await context.next();
      const headers = new Headers(res.headers);
      applySecurityHeaders(headers, path);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    // CF-IPCountry is set by Cloudflare to the visitor's ISO-3166 country code.
    // Use it for instant, accurate geo-detection before any HTML renders.
    const country = req.headers.get('CF-IPCountry') || '';

    if (!override) {
      // Ireland (inc. NI handled on the IE site) → mrcheapflights.ie
      if (country === 'IE') {
        const dest = 'https://mrcheapflights.ie' + (path === '/' ? '' : path) + url.search;
        return Response.redirect(dest, 302);
      }
      // Great Britain → mrcheapflights.co.uk
      if (country === 'GB') {
        const dest = 'https://mrcheapflights.co.uk' + (path === '/' ? '' : path) + url.search;
        return Response.redirect(dest, 302);
      }
    }

    // Unknown country (or override=1): serve the directory.html picker.
    // directory.html's JS provides a timezone/language fallback for VPN users
    // and travellers whose CF-IPCountry doesn't match their home region.
    // ?detected=1 tells the page that server-side detection ran but was
    // inconclusive — purely informational, doesn't change JS behaviour.
    const pickerUrl = new URL(req.url);
    pickerUrl.pathname = '/directory.html';
    if (!override) pickerUrl.searchParams.set('detected', '1');

    let pickerRes;
    try {
      // context.env.ASSETS serves static files from the Pages build output.
      pickerRes = await context.env.ASSETS.fetch(
        new Request(pickerUrl.toString(), { headers: req.headers })
      );
    } catch {
      pickerRes = await context.next();
    }

    const headers = new Headers(pickerRes.headers);
    applySecurityHeaders(headers, path);
    headers.set('Cache-Control', 'no-cache'); // picker is personalised by geo
    return new Response(pickerRes.body, { status: pickerRes.status, statusText: pickerRes.statusText, headers });
  }

  // ── Normal flow for mrcheapflights.ie and mrcheapflights.co.uk ───────────
  const response = await context.next();
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers, url.pathname);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
