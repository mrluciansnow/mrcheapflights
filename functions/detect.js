// Server-side region detection for mrcheap.flights directory domain.
// Reads the CF-IPCountry header Cloudflare injects on every request.
// IE → mrcheapflights.ie, GB → mrcheapflights.co.uk, others → show directory.
// Pass ?override=1 to skip auto-redirect and always show the picker.
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  if (url.searchParams.get('override') === '1') {
    return context.next();
  }

  const country = context.request.headers.get('CF-IPCountry') || '';

  if (country === 'IE') {
    return Response.redirect('https://mrcheapflights.ie', 302);
  }
  if (country === 'GB') {
    return Response.redirect('https://mrcheapflights.co.uk', 302);
  }

  // Unknown country — serve the directory picker page
  return context.next();
}
