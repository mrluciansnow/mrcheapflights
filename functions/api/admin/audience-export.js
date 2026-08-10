// GET /api/admin/audience-export?region=all|ie|uk&tier=all|free|premium&format=csv|count
//
// Exports the subscriber list as SHA-256-hashed emails for upload to Meta /
// TikTok as a Custom Audience (the seed for Lookalike audiences — the best cold
// targeting per the marketing plan). Emails are normalised (trim + lowercase)
// then hashed, so raw addresses never leave the box — the same hashing the ad
// platforms apply on their end, and GDPR-friendly for IE/UK lists.
//
// Newsletter opt-outs are excluded by default (they declined marketing);
// includeOptOut=1 overrides. format=count returns just the size (for the UI).

import { requireAdmin } from '../../_lib/auth.js';

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const session = await requireAdmin(context);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const url = new URL(context.request.url);
  const region = ['ie', 'uk'].includes(url.searchParams.get('region')) ? url.searchParams.get('region') : 'all';
  const tier = ['premium', 'free'].includes(url.searchParams.get('tier')) ? url.searchParams.get('tier') : 'all';
  const includeOptOut = url.searchParams.get('includeOptOut') === '1';
  const wantCount = url.searchParams.get('format') === 'count';

  const now = Math.floor(Date.now() / 1000);
  const where = ["email IS NOT NULL AND email != ''"];
  const binds = [];
  if (region !== 'all') { where.push('region = ?'); binds.push(region); }
  if (tier === 'premium') { where.push('current_period_end IS NOT NULL AND current_period_end > ?'); binds.push(now); }
  else if (tier === 'free') { where.push('(current_period_end IS NULL OR current_period_end <= ?)'); binds.push(now); }
  if (!includeOptOut) where.push('COALESCE(newsletter_opt_out, 0) = 0');

  const { results } = await context.env.DB.prepare(
    `SELECT email FROM subscribers WHERE ${where.join(' AND ')}`
  ).bind(...binds).all();

  const emails = [...new Set((results || []).map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean))];

  if (wantCount) {
    return Response.json({ count: emails.length, region, tier }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const hashes = await Promise.all(emails.map(sha256Hex));
  const csv = 'email_sha256\n' + hashes.join('\n') + (hashes.length ? '\n' : '');
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mcf-audience-${region}-${tier}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
