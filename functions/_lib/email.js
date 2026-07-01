// Email sending utility using Resend (resend.com — free tier: 100 emails/day).
// Setup: wrangler pages secret put RESEND_API_KEY --project-name mrcheap
//        wrangler pages secret put DIGEST_TO_EMAIL --project-name mrcheap
//
// Falls back to a no-op (logs to console) if RESEND_API_KEY is not set,
// so the digest endpoint works in testing even before Resend is configured.

export async function sendEmail(env, { to, subject, html, text }) {
  const apiKey = env.RESEND_API_KEY;
  const from = 'Mr Cheap Flights <digest@mrcheapflights.ie>';

  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — would have sent "${subject}" to ${to}`);
    return { ok: false, reason: 'not_configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, html, text }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    console.error('[email] fetch failed:', reason);
    return { ok: false, reason };
  }
  clearTimeout(timeout);

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[email] Resend error ${res.status}:`, JSON.stringify(body));
    return { ok: false, reason: body.message || res.status };
  }
  return { ok: true, id: body.id };
}
