// POST/GET /api/cron/weekly-report — emails the weekly marketing report.
// Auth: admin session OR Bearer <CRON_SECRET> (same dual pattern as the rest).
//
// ?preview=1  renders the report as HTML in the browser and sends NOTHING —
//             the safe way to inspect it (and how it's verified in dev, where
//             RESEND_API_KEY isn't set).
//
// cron-job.org schedule: Mondays 08:00 Europe/London.

import { requireAdmin } from '../../_lib/auth.js';
import { logOp } from '../../_lib/oplog.js';
import { sendEmail } from '../../_lib/email.js';
import { buildWeeklyReport } from '../../_lib/weekly-report.js';

async function handle(context) {
  const session = await requireAdmin(context);
  if (!session) {
    const auth = context.request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!context.env.CRON_SECRET || provided !== context.env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let report;
  try {
    report = await buildWeeklyReport(context.env);
  } catch (e) {
    await logOp(context.env, 'weekly-report', false, { error: e.message });
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }

  // Preview: render, don't send.
  if (new URL(context.request.url).searchParams.get('preview') === '1') {
    return new Response(report.html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }

  const to = context.env.DIGEST_TO_EMAIL || 'mrluciansnow@gmail.com';
  const result = await sendEmail(context.env, {
    to, subject: report.subject, html: report.html, text: report.text,
  });

  await logOp(context.env, 'weekly-report', !!result.ok, { ...report.stats, email: result.ok ? 'sent' : result.reason });
  return Response.json({ ok: true, email: result, stats: report.stats }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) { return handle(context); }
export async function onRequestGet(context) { return handle(context); }
