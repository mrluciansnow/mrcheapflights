// GET /api/mp/health — is the online half actually able to serve?
//
// This exists for the ten minutes after a deploy. The three things that go
// wrong when hosting a Pages project with D1 are always the same: the binding
// is missing, the migrations were never applied to production, or they were
// applied to the wrong database. All three produce a 500 from somewhere deep
// inside a game, which tells you nothing.
//
// So it answers plainly: is DB bound, which tables exist, which migrations
// are recorded, and — the only question a deploy actually needs answered —
// can a duel be played right now.
//
// It reports schema presence, never data. There is nothing here that is not
// already implied by the endpoints existing.
/* Every table the online half reads. Keeping this list right IS the endpoint's
   job, and it drifted once already: cf_duel_codes arrived with the lobby and
   was not added, so health reported ok:true while every sync threw on the
   missing table. Add a table, add it here. */
const NEED = ['cf_players', 'cf_matches', 'cf_turns', 'cf_ledger',
              'cf_duels', 'cf_kicks', 'cf_duel_codes'];

export async function onRequestGet(context) {
  const { env } = context;
  const out = { ok: false, bound: false, tables: {}, missing: [], migrations: [] };

  if (!env.DB) {
    out.error = 'no D1 binding named DB — check wrangler.toml and the Pages project settings';
    return Response.json(out, { status: 503 });
  }
  out.bound = true;

  try {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all();
    const have = new Set(rows.results.map(r => r.name));
    for (const t of NEED) out.tables[t] = have.has(t);
    out.missing = NEED.filter(t => !have.has(t));

    if (have.has('cf_migrations')) {
      const m = await env.DB.prepare(
        'SELECT name, adopted FROM cf_migrations ORDER BY name'
      ).all();
      out.migrations = m.results.map(r => r.name + (r.adopted ? ' (adopted)' : ''));
    }

    out.ok = out.missing.length === 0;
    if (!out.ok) {
      out.error = 'migrations have not been applied to this database — ' +
                  'run: node tools/migrate.mjs --remote';
    }
    /* The one number a deploy wants: can two people play right now. Counting
       open lobbies also proves the duel tables are readable, not merely
       listed in sqlite_master. */
    if (out.ok) {
      const open = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM cf_matches m JOIN cf_duels d ON d.match_id = m.id
          WHERE m.state = 'waiting'`
      ).first();
      out.openLobbies = open.n;
    }
  } catch (e) {
    out.error = 'D1 query failed: ' + (e && e.message ? e.message : String(e));
    return Response.json(out, { status: 503 });
  }

  return Response.json(out, {
    status: out.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
