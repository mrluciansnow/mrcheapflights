# Putting online multiplayer live

Everything in the repository is done and tested. What is left is hosting, and
hosting is the part nobody can automate from in here: it needs credentials and
it touches production. This is the whole of it.

## The manual tasks

**1. Two repository secrets.** Settings → Secrets and variables → Actions:

| secret | what it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | an API token with **Cloudflare Pages: Edit** and **D1: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | the account id, visible in the Cloudflare dashboard URL |

**2. The D1 binding on the Pages project.** Pages → the project → Settings →
Functions → D1 database bindings: variable name **`DB`**, database
**`mrcheapflights-prod`**. This must exist for **Production**, and separately
for **Preview** if you want previews to work. The binding is the single most
common thing to get wrong, and `/api/mp/health` is there to tell you when it is.

**3. Merge this branch to the default branch.** `workflow_dispatch` workflows
only appear in the Actions tab once they are on the default branch. Until then
the Deploy button does not exist.

**4. Run Deploy.** Actions → Deploy → Run workflow. Leave `migrate` ticked,
set `branch` to the Pages **production** branch, and put the live site URL in
`url` so the run fails loudly if online cannot serve.

That is all of it. Nothing else is manual, and nothing else needs doing again
on later deploys.

## What the deploy actually does

1. **Plans the migration** (`node tools/migrate.mjs --remote --dry`) and prints
   it, so you see what is about to touch production before it does.
2. **Migrates** (`--remote`). One command, every migration, in order, exactly
   once each.
3. **Deploys** the Pages project.
4. **Health-checks** `/api/mp/health` with six attempts, and fails the run if
   online is not serving. A green deploy therefore means online works, not
   merely that files were uploaded.

## Why the migration is safe to run on the live database

`0001`–`0004` are **not** idempotent: they create tables unguarded and insert
seed rows. Re-running them on a live database would fail, or duplicate data.
So the runner remembers, in `cf_migrations`.

The interesting case is the first run against production, which already has a
schema and no memory of how it got one. Rather than needing a hand-written
baseline, the runner **looks**: if the objects a migration creates are already
present, it records it as applied instead of running it. So production's first
run adopts `0001`–`0006` and applies only `0007`, and a fresh database runs
everything in order. One command, correct in both cases.

Verify locally first, against a database that has been through both paths:

```
node tools/migrate.mjs --dry     # says what it would do
node tools/migrate.mjs           # applies, records
node tools/migrate.mjs           # "already applied" for all seven
```

## Checking it worked

```
curl https://YOUR-SITE/api/mp/health
```

```json
{ "ok": true, "bound": true,
  "tables": { "cf_players": true, ..., "cf_duels": true, "cf_kicks": true },
  "missing": [], "migrations": ["0001_init.sql", ...], "openLobbies": 0 }
```

`ok: false` names the cause rather than making you guess:

| symptom | meaning |
|---|---|
| `bound: false` | no D1 binding named `DB` on the Pages project — task 2 |
| `missing: [...]` | migrations never reached this database — re-run Deploy with `migrate` ticked |
| HTTP 503 with `D1 query failed` | the binding points at a database that is not the one migrated |

The game asks the same endpoint before it opens a match, so a player never
gets a raw failure from inside a game — they get the sentence.

## Running the online tests against production

The suites take a base URL, so they work against the live site as well as a
local dev server. They create real matches under throwaway device tokens, so
run them against production only deliberately:

```
MP_BASE=https://YOUR-SITE npm run test:duel
```

Locally:

```
npx wrangler pages dev . --port 8788      # uses the binding in wrangler.toml
npm run migrate
npm run test:duel
```

> The `--d1 DB=name` flag creates a *different* local database from the one
> `wrangler.toml` binds. Start dev with no `--d1` flag, or the tables you
> migrated will not be the tables the server reads.

### `wrangler pages dev` needs you logged in

`wrangler.toml` carries an `[ai]` binding for the content pipeline, and
Workers AI has **no local emulator** — it always runs against Cloudflare. So
`wrangler pages dev` opens a remote proxy session for it, and without
credentials the whole dev server dies before it binds a port:

```
Failed to start the remote proxy session
Could not start remote dev session. No credentials found...
```

That is not a problem with the game. Run `npx wrangler login` once and local
dev works, AI proxied remotely and everything else local. If you want to work
offline entirely, comment out the two `[ai]` lines in `wrangler.toml` — nothing
in Croker Flicks touches that binding.

## What is still not built

The foundation and the play loop are done. Outstanding, and none of it blocks
hosting: a matchmaking screen (the transport is driven from `CF.net` today),
presence and rematch, a sweeper for lobbies nobody joins, and surfacing
reconnect — the transport rejoins a kick already submitted, but nothing in the
UI says so.
