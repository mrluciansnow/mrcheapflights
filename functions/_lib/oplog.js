// Operations log helper — fire-and-forget, never throws, never blocks the
// caller's real work. One row per automation run; the admin briefing reads
// the last 24h so cron failures surface in the morning email.
/**
 * Mark a run as STARTED. Returns the row id, or null if logging failed.
 *
 * Why this exists: cron-job.org kills a request at 30s. When that happens the
 * Worker is terminated mid-flight, so the logOp() at the end never runs and the
 * failure leaves NO trace in op_log at all. The daily enrich job died this way
 * every morning for weeks and the digest showed nothing, because from op_log's
 * point of view the run simply never happened. Recording the start closes that
 * blind spot: a row still sitting at 'running' is a run that was killed.
 */
export async function startOp(env, kind) {
  try {
    const r = await env.DB.prepare(
      "INSERT INTO op_log (kind, ok, detail) VALUES (?, 0, '{\"status\":\"running\"}')"
    ).bind(String(kind).slice(0, 30)).run();
    return r?.meta?.last_row_id ?? null;
  } catch { return null; }
}

/** Close a run opened with startOp(). Falls back to a fresh row if id is null. */
export async function finishOp(env, id, kind, ok, detail) {
  if (id == null) return logOp(env, kind, ok, detail);
  try {
    const json = detail == null ? null : JSON.stringify(detail).slice(0, 2000);
    await env.DB.prepare(
      'UPDATE op_log SET ok=?, detail=?, created_at=unixepoch() WHERE id=?'
    ).bind(ok ? 1 : 0, json, id).run();
  } catch { /* logging must never break the pipeline */ }
}

export async function logOp(env, kind, ok, detail) {
  try {
    const json = detail == null ? null : JSON.stringify(detail).slice(0, 2000);
    await env.DB.prepare(
      'INSERT INTO op_log (kind, ok, detail) VALUES (?, ?, ?)'
    ).bind(String(kind).slice(0, 30), ok ? 1 : 0, json).run();
  } catch { /* logging must never break the pipeline */ }
}
