// Global middleware — runs on every request to the Pages project.
// Adds security headers and blocks search engine indexing of admin routes.
export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);

  const headers = new Headers(response.headers);

  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Prevent admin API routes from being cached or indexed
  if (url.pathname.startsWith('/api/admin')) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
