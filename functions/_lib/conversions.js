// Server-side conversion events — Meta Conversions API + TikTok Events API.
//
// Closes the last link in the loop: ad → click → landing → signup → *back to
// the platform*, so its optimisation model learns who actually converts. This
// is the biggest lever on CPA, and unlike a browser pixel it survives
// ad-blockers and Safari ITP.
//
// ─────────────────────────────────────────────────────────────────────────────
// SCOPE + PRIVACY RULES — read before widening any of this.
//
//  1. OFF BY DEFAULT. Nothing is sent unless CONVERSIONS_ENABLED=1. Sharing
//     subscriber data with an ad platform is the site owner's call to make
//     (GDPR: IE/UK subscribers), not a default.
//  2. CAMPAIGN-ATTRIBUTED ONLY. We only report a conversion for someone who
//     actually arrived from a tracked ad (subscribers.source set). Organic
//     signups are never sent — they have no relationship to the ad platform,
//     so sharing them would be unnecessary data disclosure.
//  3. HASHED PII ONLY. Emails are SHA-256 hashed before they leave the box —
//     the same normalisation (trim + lowercase) the platforms apply. Raw
//     addresses are never transmitted and never stored in conversion_events.
//  4. SANDBOX-SAFE. A filler `sandbox…` token simulates the send (logged,
//     never transmitted), matching the ad-automation safety model.
//  5. NEVER BLOCKS. Called from signup's waitUntil; every path is caught, so a
//     platform outage can never fail or slow a real signup.
//
// Config reuses the ad-automation connection: env.META_ACCESS_TOKEN /
// env.TIKTOK_ACCESS_TOKEN plus ad_accounts.pixel_id per platform. No new
// secrets — if a platform has no pixel_id set, it's simply skipped.
// ─────────────────────────────────────────────────────────────────────────────

const META_GRAPH = 'https://graph.facebook.com/v21.0';
const TIKTOK_EVENTS = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function conversionsEnabled(env) { return env.CONVERSIONS_ENABLED === '1'; }

function isSandboxToken(t) { return /^sandbox/i.test(String(t || '').trim()); }

function tokenFor(env, platform) {
  return String((platform === 'meta' ? env.META_ACCESS_TOKEN : env.TIKTOK_ACCESS_TOKEN) || '').trim();
}

async function logEvent(env, row) {
  try {
    await env.DB.prepare(
      `INSERT INTO conversion_events (event_id, platform, event_name, subscriber_id, source, source_variant, status, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET status=excluded.status, detail=excluded.detail`
    ).bind(row.eventId, row.platform, row.eventName, row.subscriberId ?? null, row.source ?? null,
           row.sourceVariant ?? null, row.status, row.detail == null ? null : String(row.detail).slice(0, 400)).run();
  } catch { /* audit must never break the flow */ }
}

// ── Meta Conversions API ─────────────────────────────────────────────────────
async function sendMeta(env, { pixelId, token, eventId, eventName, emailHash, eventTime, sourceUrl, ip, ua }) {
  const payload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,              // dedup against any browser pixel
      action_source: 'website',
      event_source_url: sourceUrl || undefined,
      user_data: {
        em: [emailHash],
        client_ip_address: ip || undefined,
        client_user_agent: ua || undefined,
      },
    }],
  };
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${META_GRAPH}/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(to);
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) return { ok: false, error: body?.error?.message || `HTTP ${res.status}` };
    return { ok: true, detail: `events_received=${body?.events_received ?? '?'}` };
  } catch (e) {
    clearTimeout(to);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

// ── TikTok Events API ────────────────────────────────────────────────────────
async function sendTiktok(env, { pixelId, token, eventId, eventName, emailHash, eventTime, sourceUrl, ip, ua }) {
  const payload = {
    event_source: 'web',
    event_source_id: pixelId,
    data: [{
      event: eventName,
      event_time: eventTime,
      event_id: eventId,
      user: { email: emailHash, ip: ip || undefined, user_agent: ua || undefined },
      page: { url: sourceUrl || undefined },
    }],
  };
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(TIKTOK_EVENTS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': token },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(to);
    const body = await res.json().catch(() => null);
    // TikTok returns HTTP 200 with the real status in `code` (0 = success).
    if (!res.ok || !body || body.code !== 0) return { ok: false, error: body?.message || `HTTP ${res.status}` };
    return { ok: true, detail: 'code=0' };
  } catch (e) {
    clearTimeout(to);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

/**
 * Report one conversion to every configured platform. Best-effort and fully
 * guarded — safe to call from waitUntil. Returns a small summary for tests.
 *
 * @param {object} opts
 *  email, subscriberId, source, sourceVariant, eventName, request (for ip/ua/url)
 */
export async function trackConversion(env, { email, subscriberId, source, sourceVariant, eventName = 'CompleteRegistration', request } = {}) {
  const out = { sent: [], skipped: [], errors: [] };
  try {
    // Rule 2: only report ad-attributed conversions.
    if (!source) { out.skipped.push({ reason: 'not campaign-attributed' }); return out; }

    const eventTime = Math.floor(Date.now() / 1000);
    const emailHash = await sha256Hex(String(email || '').trim().toLowerCase());
    const ip = request?.headers?.get('CF-Connecting-IP') || null;
    const ua = request?.headers?.get('User-Agent') || null;
    const sourceUrl = request ? new URL(request.url).origin + '/c/' + source : null;

    for (const platform of ['meta', 'tiktok']) {
      // Deterministic-ish unique id per subscriber+platform+event: dedups
      // retries, and matches what a browser pixel would send.
      const eventId = `${platform}-${eventName}-${subscriberId || 'anon'}-${eventTime}`;
      const base = { eventId, platform, eventName, subscriberId, source, sourceVariant };

      // Rule 1: master switch.
      if (!conversionsEnabled(env)) {
        await logEvent(env, { ...base, status: 'skipped', detail: 'CONVERSIONS_ENABLED not set' });
        out.skipped.push({ platform, reason: 'disabled' });
        continue;
      }

      const token = tokenFor(env, platform);
      if (!token) {
        await logEvent(env, { ...base, status: 'skipped', detail: 'no token' });
        out.skipped.push({ platform, reason: 'no token' });
        continue;
      }

      let pixelId = null;
      try {
        const acct = await env.DB.prepare('SELECT pixel_id FROM ad_accounts WHERE platform=?').bind(platform).first();
        pixelId = acct?.pixel_id || null;
      } catch { /* pre-migration */ }
      if (!pixelId) {
        await logEvent(env, { ...base, status: 'skipped', detail: 'no pixel_id configured' });
        out.skipped.push({ platform, reason: 'no pixel' });
        continue;
      }

      // Rule 4: sandbox simulates — logged, never transmitted.
      if (isSandboxToken(token)) {
        await logEvent(env, { ...base, status: 'skipped', detail: 'sandbox — simulated, not transmitted' });
        out.skipped.push({ platform, reason: 'sandbox' });
        continue;
      }

      const args = { pixelId, token, eventId, eventName, emailHash, eventTime, sourceUrl, ip, ua };
      const res = platform === 'meta' ? await sendMeta(env, args) : await sendTiktok(env, args);
      if (res.ok) {
        await logEvent(env, { ...base, status: 'sent', detail: res.detail });
        out.sent.push({ platform });
      } else {
        await logEvent(env, { ...base, status: 'error', detail: res.error });
        out.errors.push({ platform, error: res.error });
      }
    }
  } catch (e) {
    out.errors.push({ error: e.message });
  }
  return out;
}

/** Recent conversion activity for the admin dashboard (read-only). */
export async function conversionsStatus(env, limit = 8) {
  const status = {
    enabled: conversionsEnabled(env),
    platforms: {},
    recent: [],
    totals: { sent: 0, skipped: 0, error: 0 },
  };
  for (const p of ['meta', 'tiktok']) {
    let pixel = null;
    try {
      const a = await env.DB.prepare('SELECT pixel_id FROM ad_accounts WHERE platform=?').bind(p).first();
      pixel = a?.pixel_id || null;
    } catch { /* pre-migration */ }
    const token = tokenFor(env, p);
    status.platforms[p] = { pixel_set: !!pixel, token_present: !!token, sandbox: isSandboxToken(token) };
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM conversion_events GROUP BY status`
    ).all();
    for (const r of results || []) status.totals[r.status] = r.n;
    const recent = await env.DB.prepare(
      `SELECT platform, event_name, status, detail, source, created_at
       FROM conversion_events ORDER BY id DESC LIMIT ?`
    ).bind(Math.min(25, Math.max(1, limit))).all();
    status.recent = recent.results || [];
  } catch { /* pre-migration */ }
  return status;
}
