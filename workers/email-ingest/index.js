// Cloudflare Email Worker — forwards newsletters to the site's ingest endpoint.
//
// Intentionally does NO parsing: it reads the message and POSTs it on, so all
// deal-extraction logic stays in the Pages app where it's testable and can
// change without redeploying this.
//
// Bound to deals@mrcheapflights.ie via Email Routing (see README).

const INGEST_URL = 'https://mrcheapflights.ie/api/ingest/email';
const MAX_BYTES = 1_500_000; // newsletters are big; cap what we forward

async function readStream(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, total - off)), off); off += c.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

// Pull the HTML (or text) body out of the raw MIME message. Good enough for
// newsletters, which are near-universally quoted-printable multipart/alternative.
function extractBodies(raw) {
  const out = { html: '', text: '' };
  const parts = raw.split(/\r?\n--/);
  for (const part of parts) {
    const isHtml = /Content-Type:\s*text\/html/i.test(part);
    const isText = /Content-Type:\s*text\/plain/i.test(part);
    if (!isHtml && !isText) continue;
    const sep = part.search(/\r?\n\r?\n/);
    if (sep === -1) continue;
    let body = part.slice(sep).trim();
    if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(part)) {
      body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    } else if (/Content-Transfer-Encoding:\s*base64/i.test(part)) {
      try { body = atob(body.replace(/\s+/g, '')); } catch { /* leave as-is */ }
    }
    if (isHtml && !out.html) out.html = body;
    if (isText && !out.text) out.text = body;
  }
  if (!out.html && !out.text) out.text = raw.slice(0, MAX_BYTES);
  return out;
}

export default {
  async email(message, env, ctx) {
    let raw = '';
    try { raw = await readStream(message.raw, MAX_BYTES); } catch { /* fall through */ }
    const { html, text } = extractBodies(raw);

    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.INGEST_SECRET}`,
      },
      body: JSON.stringify({
        from: message.from,
        subject: message.headers.get('subject') || '',
        html, text,
      }),
    }).catch(() => null);

    // Never reject the mail on our own failure — a bounce would unsubscribe us
    // from the newsletter. Log and move on; op_log records what landed.
    if (!res || !res.ok) console.log('ingest failed', res ? res.status : 'network');
  },
};
