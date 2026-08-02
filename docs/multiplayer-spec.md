# Croker Flicks — Multiplayer Specification

Stage 3 deliverable. Local multiplayer is **built**; this document specifies the
online model precisely enough that Stage 4 is implementation rather than design.

---

## 1. The property everything rests on: determinism

The simulation is a fixed-step integrator (1/60s) with no frame-rate coupling.
As of Stage 3 all outcome-deciding randomness comes from a seeded
`mulberry32` stream, while cosmetic randomness (crowd, grass, confetti, rain,
camera shake) stays on `Math.random`. The consequence:

> **A kick is fully described by its inputs. Given the same inputs, every
> device produces the same outcome, to the last decimal place.**

### Verified
`?debug=1` exposes `window.CF.simulate(record)`. The regression harness runs 40
records spanning all four keeper tiers, both wall configurations and spots from
11m to 45m:

| Check | Result |
|---|---|
| Same page, records replayed in reverse order | 40/40 identical |
| Fresh page, fresh browser context | 40/40 identical |
| Ball rest position agreement | to 9 decimal places |
| Same kick index, two different players | identical wind and weather |
| Consecutive kick indices | conditions differ |

That last pair is what makes local rounds fair, and it is the same mechanism
that will make online rounds fair.

---

## 2. The input record

```jsonc
{
  "matchSeed": 3221225472,   // uint32, issued by the server at match creation
  "kickIndex": 3,            // which kick in the match
  "power":     0.612,        // 0..1
  "aimM":     -2.41,         // metres of lateral aim at the goal plane
  "curl":      0.63,         // -1..1, from the bow of the swipe
  "spot":      { "x": 12, "z": 45 },
  "difficulty":"senior"
}
```

Roughly 90 bytes as JSON, under 20 packed. Conditions are **not** transmitted —
wind, weather, ground and keeper behaviour are all derived from
`hash2(matchSeed, kickIndex)`, so both clients and the server compute them
independently and identically.

The client sends what the player *did*. It never sends what happened.

---

## 3. Model: asynchronous turn-based

Real-time is the wrong first target for a game of discrete kicks — it buys
netcode, rollback and presence for no gameplay gain. The model is:

1. Player A takes their five kicks whenever they like.
2. Player B is notified, takes theirs.
3. The match resolves; the economy settles.

This suits phones, tolerates dropped connections, and needs no persistent
socket. Live head-to-head can layer on later as a synchronous *view* of the same
turn protocol.

---

## 4. Stack: Cloudflare, because it is already provisioned

The repository already runs on Cloudflare Pages with `functions/api/`, a bound
D1 database (`DB` in `wrangler.toml`) and `functions/_lib/auth.js`. No new
vendor is required.

| Concern | Component |
|---|---|
| API + re-simulation | Workers (Pages Functions) |
| Per-match coordination | Durable Objects — one per match, single-threaded, removes turn-sync races |
| Users, matches, turns, ledger | D1 |
| Turn notifications | Web Push |

Supabase or Firebase would stand up faster but add a vendor and split the stack.

### Schema sketch

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY, handle TEXT UNIQUE, county TEXT, kit TEXT,
  xp INTEGER DEFAULT 0, money INTEGER DEFAULT 500,
  rank INTEGER DEFAULT 0, created_at INTEGER, last_seen INTEGER
);
CREATE TABLE matches (
  id TEXT PRIMARY KEY, seed INTEGER NOT NULL, mode TEXT NOT NULL,
  a_user TEXT NOT NULL, b_user TEXT, state TEXT NOT NULL,
  turn TEXT, rounds INTEGER DEFAULT 5, created_at INTEGER, resolved_at INTEGER
);
CREATE TABLE turns (
  match_id TEXT, user_id TEXT, kick_index INTEGER,
  record TEXT NOT NULL,        -- the input record, verbatim
  outcome TEXT NOT NULL,       -- server-computed, never client-supplied
  created_at INTEGER,
  PRIMARY KEY (match_id, user_id, kick_index)
);
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, delta INTEGER,
  reason TEXT, match_id TEXT, created_at INTEGER
);
```

`turns` is keyed on `(match_id, user_id, kick_index)`, so a retried submission
is idempotent — the same kick cannot be played twice or scored twice.

### API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/mp/match` | create or join; returns `{matchId, seed, rounds}` |
| `POST` | `/api/mp/turn` | submit one input record |
| `GET` | `/api/mp/match/:id` | poll state, opponent progress, results |
| `POST` | `/api/mp/challenge` | friend challenge, returns a share link |
| `GET` | `/api/mp/inbox` | matches awaiting your turn |

### Match state machine

```
created → waiting → in_progress ⇄ (turn: A | B) → resolved → settled
                          ↓
                       expired            (turn timer elapsed)
```

`settled` is a distinct state from `resolved`: results are final before any
currency moves, so a crash between the two cannot double-pay.

---

## 5. Anti-cheat

The server holds the seed and re-runs the same deterministic simulation over
each submitted record. Concretely:

1. Reject records whose `kickIndex` is not the caller's next expected kick.
2. Reject out-of-range inputs (`power` ∉ [0,1], `|curl|` > 1, `|aimM|` > 6).
3. Re-simulate. **The server's outcome is the outcome** — the client's opinion
   is never stored or trusted.
4. Rate-limit submissions per user and per match.
5. All XP and currency mutations happen server-side, in the `ledger` table.

Stage 1 already routes every client-side mutation through `awardXP`,
`credit` and `debit`, so replacing those three functions with API calls is the
whole client-side change.

**Residual risk:** a modified client can still take unlimited practice attempts
locally before submitting its best. Async turn-based play cannot fully prevent
this. Mitigations, in order of cost: a per-turn server-issued deadline; ranked
ladders seeded per day so practice does not transfer; and accepting it for
friendlies while restricting ranked play to timed turns.

---

## 6. Float determinism — the one real risk

Everything above assumes IEEE-754 double arithmetic agrees across devices. For
`+ - * /` and `sqrt` it is exact per spec. The risk sits in `Math.sin`,
`Math.cos`, `Math.atan2`, `Math.pow` and `Math.exp`, which are
**implementation-defined** and *may* differ between JS engines.

The simulation uses `sin`/`cos`/`atan2` in the launch calculation and `hypot`
in drag. Verified identical across Chromium page loads, but **not yet across
engines**.

**Stage 4 must measure this on real iOS Safari and Android Chrome before
matchmaking is built.** If divergence appears, in order of preference:

1. Replace the transcendentals in the physics path with polynomial
   approximations shared by client and server (removes the dependency entirely).
2. Quantise inputs and compare outcomes with a tolerance, treating small
   divergence as a draw-to-server-authority.
3. Fall back to server-authoritative simulation with the client rendering a
   replay of the server's result.

Option 1 is cheap and worth doing pre-emptively if any divergence is found.

---

## 7. Client changes required in Stage 4

- Swap `awardXP` / `credit` / `debit` for API-backed versions (already funnelled).
- Add an account layer: anonymous device id first, upgradeable to a real
  account without losing progress.
- Build the input record at `fire()` and submit it rather than resolving
  locally — or resolve locally *and* submit, reconciling on the server's reply.
- Add an inbox screen for matches awaiting a turn.
- Local profile becomes a cache of server state, with explicit conflict
  resolution on first sign-in.
