// Operations log helper — fire-and-forget, never throws, never blocks the
// caller's real work. One row per automation run; the admin briefing reads
// the last 24h so cron failures surface in the morning email.
export async function logOp(env, kind, ok, detail) {
  try {
    const json = detail == null ? null : JSON.stringify(detail).slice(0, 2000);
    await env.DB.prepare(
      'INSERT INTO op_log (kind, ok, detail) VALUES (?, ?, ?)'
    ).bind(String(kind).slice(0, 30), ok ? 1 : 0, json).run();
  } catch { /* logging must never break the pipeline */ }
}
