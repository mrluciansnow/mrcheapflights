// Shared crypto + cookie helpers for Pages Functions.
// Deliberately dependency-free — uses the Workers runtime's Web Crypto
// (crypto.subtle) directly rather than pulling in a hashing library.

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export function randomHex(byteLen) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// PBKDF2 params — fixed here because the seed migration's bootstrap hash
// must be generated with these exact same params to verify correctly.
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_BYTES = 32;

export async function hashPassword(password, saltHex) {
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_KEY_BYTES * 8
  );
  return bytesToHex(new Uint8Array(derived));
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password, saltHex, expectedHashHex) {
  const computed = await hashPassword(password, saltHex);
  return timingSafeEqual(computed, expectedHashHex);
}

function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

// Signed, stateless session token: base64url(JSON payload) + "." + HMAC-SHA256 hex signature.
export async function signSession(payload, secret) {
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifySession(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expectedSig = await hmacSha256(secret, payloadB64);
  if (!timingSafeEqual(sig, expectedSig)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  } catch {
    return null;
  }
  if (typeof payload.exp === 'number' && Date.now() > payload.exp) return null;
  return payload;
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function setCookieHeader(name, value, { maxAgeSeconds, httpOnly = true, sameSite = 'Strict', secure = true } = {}) {
  // secure:false exists ONLY for plain-http local dev (wrangler pages dev) —
  // embedded browsers refuse to store Secure cookies over http, which made the
  // admin pipeline untestable locally. Production is always https.
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${sameSite}`];
  if (secure) parts.splice(1, 0, 'Secure');
  if (httpOnly) parts.push('HttpOnly');
  if (maxAgeSeconds != null) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

export function clearCookieHeader(name) {
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}

// Resolves the visitor's membership tier from the mcf_member cookie:
// 'guest' (no valid cookie/subscriber) | 'free' | 'premium' (time-based, same
// rule as /api/me). Used to gate fare details server-side — gated data is
// WITHHELD from the payload, never just hidden with CSS.
export async function resolveMemberTier(context) {
  const cookie = getCookie(context.request, 'mcf_member');
  if (!cookie) return 'guest';
  const session = await verifySession(cookie, context.env.SESSION_SIGNING_SECRET);
  if (!session) return 'guest';
  const row = await context.env.DB.prepare(
    'SELECT current_period_end FROM subscribers WHERE member_token = ?'
  ).bind(session.sub).first();
  if (!row) return 'guest';
  const now = Math.floor(Date.now() / 1000);
  return row.current_period_end != null && row.current_period_end > now ? 'premium' : 'free';
}

// Premium-only deal rule — mirror of the client's isGated(): these badges are
// the premium shelf (error fares are already a premium email perk).
export function isPremiumBadge(badge) {
  const b = String(badge || '');
  return b.includes('Long Haul') || b.includes('Featured') || b.includes('Mistake');
}

// Verifies the admin session cookie. Returns the session payload, or null if
// missing/invalid/expired — callers should respond 401 on null.
export async function requireAdmin(context) {
  const token = getCookie(context.request, 'mcf_admin');
  if (!token) return null;
  const session = await verifySession(token, context.env.SESSION_SIGNING_SECRET);
  if (!session || session.role !== 'admin') return null;
  return session;
}
