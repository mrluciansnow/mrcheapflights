// GET /api/unsubscribe?token=<member_token>
// One-click opt-out from the daily deals digest, linked from every newsletter
// footer. Sets newsletter_opt_out=1 — membership/premium status is untouched.
// Always returns the same page whether or not the token matched, so the
// endpoint can't be used to probe which tokens exist.

export async function onRequestGet(context) {
  const token = new URL(context.request.url).searchParams.get('token') || '';

  if (token && token.length <= 128) {
    try {
      await context.env.DB.prepare(
        'UPDATE subscribers SET newsletter_opt_out=1, updated_at=unixepoch() WHERE member_token=?'
      ).bind(token).run();
    } catch {
      // fall through to the same response — never surface DB state
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Unsubscribed · Mr Cheap Flights</title>
<style>
body{background:#060B1F;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
.card{background:#0A0F2E;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px 32px;max-width:420px;text-align:center;}
h1{color:#FFD700;font-size:22px;margin:0 0 10px;}
p{color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin:0 0 22px;}
a{display:inline-block;background:#FFD700;color:#0A0F2E;font-weight:bold;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;}
small{display:block;margin-top:18px;color:rgba(255,255,255,0.25);font-style:italic;}
</style></head>
<body><div class="card">
  <h1>✈ You're unsubscribed</h1>
  <p>You won't get the daily deals digest any more. Your account and any premium perks are unchanged — and you can rejoin from the site whenever you like.</p>
  <a href="/">Back to the deals →</a>
  <small>Cheap never looked this good.</small>
</div></body></html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
