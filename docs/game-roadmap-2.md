# Croker Flicks — Roadmap II

Roadmap I (`game-roadmap.md`) took the game from a static penalty shootout to a
five-mode game with curl, a reading keeper, a championship run, free kicks, the
two-point arc, replays and weather. Stages 1–4 of that plan are shipped; its
Stage 5 ("Reasons to Return") is **deferred** — most of it is absorbed here:
achievements land in Stage 1, daily/weekly challenges and leaderboards in
Stage 5.

This roadmap turns a good game into one with an economy, a wardrobe, real
venues, and other people to play against.

| Stage | Theme | Status |
|---|---|---|
| 1 | Ranks, Money and the Kitbag | **Shipped** |
| 2 | Grounds and Fidelity | **Shipped** |
| 3 | Multiplayer: local play, and the online blueprint | **Shipped** |
| 4 | Online, Accounts and Hardening | Planned |
| 5 | The Living Season | Planned |

---

## Ground rules

Three constraints that shape several stages. Worth settling now rather than
unpicking later.

- **Kits.** Heritage kits reproduce the real historic county designs — the
  actual colours and patterns those counties wore, named by county and era.
  What stays out is the *badge*: no county crests, sponsor wordmarks or
  manufacturer logos. Those are live trademarks with active commercial deals
  behind them, and they are also not what anyone recognises a jersey by. The
  colours and the pattern are the jersey.
- **Venues.** The real grounds, under their real names, with their actual
  architecture and orientation — Croke Park, Semple Stadium, Fitzgerald
  Stadium, Páirc Uí Chaoimh and the rest. Buildings and place names are fair to
  depict; what stays out is *branding* — no reproduced sponsor wordmarks on the
  hoardings and no county crests. The pitch-side boards carry Mr Cheap Flights,
  which is the site's own brand.
- **Betting is virtual only.** Currency is earned in play. It is never
  purchasable with real money and never cashable out, and the game never
  simulates a real sportsbook. That keeps it a wager mechanic rather than
  gambling — which matters more than usual, because this sits on a commercial
  flights site.

---

## Stage 1 — Ranks, Money and the Kitbag

**Goal.** Give every kick a second payoff. Right now a good shot moves a
scoreline and nothing else; after this it also moves a rank, a balance and a
wardrobe.

### 1.1 Points and ranks
Points (XP) are awarded per score, weighted by how hard the score was:

| Event | Base | Multipliers |
|---|---|---|
| Point | 10 | × difficulty tier (1.0 → 1.6) |
| Two-pointer | 25 | × distance beyond the arc |
| Goal | 40 | × difficulty tier |
| Curled score | +50% | only when curl exceeded a threshold |
| Streak | +5 per kick in streak | caps at +50 |
| Award unlocked | 100–1000 | one-off |

**Awards** are the achievement layer: *Green flag from the corner*, *Five in a
row*, *Two-pointer in driving rain*, *Beat the All-Ireland keeper without
conceding a save*, *Win a championship without a miss*. Each pays XP once.

**Ranks** are a GAA-flavoured ladder gating content:

Junior B → Junior A → Intermediate → Senior B → Senior A → County → Provincial
→ All-Star → Legend

Ranks unlock **game modes**, which also fixes a current problem: all five modes
are dumped on the player at once with no sense of progression.

| Rank | Unlocks |
|---|---|
| Junior B (start) | Quick Match, Championship |
| Junior A | Free Kicks |
| Intermediate | Survival, Intermediate keeper tier |
| Senior B | Local Multiplayer |
| Senior A | Senior keeper tier |
| County | All-Ireland keeper tier |
| Provincial | Gauntlet (all ten spots, one life) |
| All-Star | Seasonal modes (Stage 5) |

### 1.2 Money
Currency (working name: **gate receipts**) comes from three places:

- **Fixed purses.** Championship round win 250, final 1000; quick match 80;
  survival 10/kick survived; free kicks 25/score.
- **Match bet.** Before a match, stake on yourself to win. **Evens.**
- **Shot bet ("back yourself").** Before a single kick, stake on scoring it.
  **Evens.**

**All wagers are evens — no odds ladder.** Money is a flat risk/reward dial:
stake it, double it or lose it. Differentiation by *type* of score lives
entirely in the points system above, where a curled two-pointer against an
All-Ireland keeper is worth many times a tapped-over point. Points are the skill
ledger; money is the nerve ledger. Keeping odds out of it also keeps the
mechanic unambiguously a game feature rather than a simulated sportsbook.

**Anti-soft-lock:** a minimum stipend per match, and stakes capped at a
percentage of balance, so a losing streak can never leave a player unable to
bet or progress.

### 1.3 The Kitbag
Money buys kits, in three rarities:

- **Standard** — your county's colours in the base pattern.
- **Rare** — pattern variants: hoops, sash, halves, quarters, band, trim.
- **Heritage** — the real historic designs, named by county and era ("Kerry
  1975 Hoops", "Dublin 1995", "Donegal 1992"), each with a short blurb on why
  that jersey is remembered. These are the chase items.

### 1.4 The prerequisite nobody asks for but the whole stage needs
**The player's kit is currently invisible.** The camera sits behind the kicker
and the kicker is not drawn, so a wardrobe would be a wardrobe nobody sees.
Stage 1 must therefore add a **foreground kicker figure** — seen from behind,
mid-run-up, in your chosen kit. This is a win regardless of the economy: it is
exactly the framing of a real penalty photograph, and it grounds the shot.

Secondary surfaces for kit display: the kitbag screen, the scoreboard crest,
and your own keeper when defending.

### Technical notes
- The save schema is `crokerFlicks.v1`. This stage bumps it to **v2** with a
  real migration function — existing players must not lose their unlocks,
  conversion rate or best streak.
- All currency and XP mutation goes through single `awardXP()` / `credit()` /
  `debit()` functions from day one. Stage 4 moves these server-side, and that is
  far cheaper if every mutation already runs through one door.

### Acceptance criteria
- XP, rank, balance, kits and awards persist across reload and survive the v1→v2
  migration with no data loss.
- No sequence of bets can leave a player unable to continue.
- Mode gating is enforced in the UI *and* at mode entry.
- The equipped kit is visible on the kicker during play.

---

## Stage 2 — Grounds and Fidelity

**Goal.** Make where you are playing matter as much as what you are playing.

### 2.1 A venue system
The stand is currently generated inside `buildBackground()` from hardcoded
constants — 34 rows raked between z −11.5 and −27, a fixed roof, one hoarding
style. Stage 2 extracts a **venue descriptor**:

```
{ name, capacity, palette, tiers:[{z0,z1,y0,y1,rake,style}], roof,
  endTerrace, floodlights, hoardingStyle, pitchWear, weatherBias }
```

Then builds the real grounds, each modelled on its actual architecture:

- **Croke Park**, Dublin — 82,300. Three vast tiers across the Cusack, Hogan and
  Davin stands, with Hill 16 as a single open terrace at one end. The flagship,
  and the neutral venue for finals.
- **Semple Stadium**, Thurles — 45,000. The old Ard Craobh terrace opposite a
  long covered stand, wide open at the ends.
- **Fitzgerald Stadium**, Killarney — 38,000. Grass banks and terracing with
  MacGillycuddy's Reeks over the far side — the most distinctive skyline in the
  country.
- **Páirc Uí Chaoimh**, Cork — 45,000. The rebuilt continuous bowl under a
  sweeping single-tier roof.
- **MacHale Park**, Castlebar — 30,000. Steep covered stand, open terracing,
  exposed western weather.
- **St Tiernach's Park**, Clones — 36,000. The sloping Ulster ground with banked
  terracing on the hill side.

Each carries its real capacity, crowd density, stand geometry and weather bias.

### 2.2 Home and away
Each county gets a home venue. Matches use the home team's ground; finals go to
a neutral national venue. The **crowd colour mix skews to the home county**
(currently a flat 50/50 split), and the ambient crowd bed gets louder and more
partisan at home. Playing away should feel measurably less comfortable.

### 2.3 Realism and graphics
- **Kicker** with a run-up, plant and follow-through, tied to power and curl.
- **Keeper** gains pose states: set, adjusting step, dive, recover, beaten.
- **Turf** that remembers: divots accumulate through a session, a scuffed
  penalty spot, a worn goalmouth.
- **Lighting** by time of day — afternoon sun with directional shadows, or
  floodlit evening. Shadows currently render as a single downward ellipse per
  object; they should follow the light direction and lengthen.
- **Net** with per-strand slack and ripple that propagates rather than decaying
  in place.
- **Crowd** with banners, occasional camera flashes, and a standing wave on a
  goal.
- **Ball** with wet sheen and a spin axis tied to the curl actually applied.

### Technical notes
Keep the pre-rendered-background architecture — it is what keeps the frame loop
cheap. Add a **per-venue offscreen cache** so switching grounds costs one build,
not one per kick. Hold a hard performance budget: the background rebuild already
runs on every kick because the camera moves, and venues must not make that
worse.

### Acceptance criteria
- 60fps on a mid-range phone with rain and a full crowd.
- Venue switch costs at most one background rebuild.
- Home crowd skew is visible on screen and audible in the mix.

---

## Stage 3 — Multiplayer: local play, and the online blueprint

Two halves: one ships, one is a specification.

### 3.1 Local multiplayer — ship it
Two-player pass-and-play exists but is thin (alternating penalties, one hand-over
screen). Expand to a proper local layer:

- **2–4 players**, each choosing county and kit.
- **Formats**: shootout, free-kick contest, survival knockout (last one
  standing), and *Around the Ground* — hit designated spots in sequence.
- **Fairness through seeding.** Every player in a round must face identical
  wind, weather and keeper behaviour. Today that is impossible: there are ~38
  `Math.random()` / `rand()` call sites, and gameplay randomness is
  indistinguishable from cosmetic randomness.

**This is the pivotal piece of work in the whole roadmap.** Split randomness in
two:

- a **seeded PRNG** (mulberry32 or xorshift128) for everything that affects
  outcome — wind, weather, keeper reaction/error/target, contact slip;
- the existing unseeded generator for cosmetics — crowd colours, grass grain,
  confetti.

Fixed-step integration is already in place, so with seeded gameplay randomness
the simulation becomes **deterministic**. That single property buys three
things: fair local rounds, the entire online model below, and Stage 5's daily
challenges.

### 3.2 The online blueprint — design only
No server code this stage. The deliverable is a specification precise enough to
implement without redesign.

**The core idea: ship inputs, not outcomes.** Because the simulation is
deterministic, a kick is fully described by a tiny **input record**:

```
{ seed, mode, spotIndex, power, aimM, curl, slipSeed }
```

A few dozen bytes. Every client replays it to an identical flight. The server
can re-simulate it to verify the claimed result. This makes async multiplayer
almost free and makes cheating a re-simulation check rather than an arms race.

**Model: asynchronous turn-based first.** Real-time is the wrong first target
for a game of discrete kicks — it adds netcode, rollback and presence for no
gameplay gain. Async ("take your five, opponent takes theirs, results resolve")
suits both the game and how people play on phones.

**Recommended stack: Cloudflare — because it is already here.** The repo runs on
Pages with `functions/api/`, a D1 binding (`DB`), and an existing
`functions/_lib/auth.js`. No new vendor required:

- **D1** — users, matches, turns, ledger.
- **Durable Objects** — one per match, giving single-threaded coordination and
  removing the race conditions that make turn-based sync painful.
- **Workers** — API, re-simulation, matchmaking.

Alternatives (Supabase, Firebase) stand up faster but add a vendor and split the
stack; not worth it given what is already provisioned.

**API sketch**

| Endpoint | Purpose |
|---|---|
| `POST /api/mp/match` | create or join; returns match id + seed |
| `POST /api/mp/turn` | submit an input record |
| `GET  /api/mp/match/:id` | poll state |
| `POST /api/mp/challenge` | friend challenge via share link |

**Match state machine:** `created → waiting → in_progress(turn A|B) → resolved →
settled` (settled = economy applied).

**Anti-cheat:** the server re-simulates every submitted input record against the
stored seed and rejects any mismatch with the claimed outcome. Currency and XP
mutate server-side only. Rate-limit submissions. Never trust a client-reported
score.

**Resilience:** submit-and-forget with retry, optimistic local display,
reconciliation on poll. A dropped connection mid-kick must never lose a turn.

### What shipped
- **Seeded gameplay randomness.** Wind, weather, ground, the keeper's reaction
  and read, the CPU's choice and contact slip all draw from a seeded
  `mulberry32` stream; crowd, grass, confetti, rain and camera shake stay on
  `Math.random`. Each kick re-seeds from `hash2(matchSeed, kickIndex)`.
- **Local multiplayer for 2–4** on one device: round-robin kicking, a hand-over
  screen with live standings, and a final table. Guest players do not earn the
  device owner's points or money.
- **A `?debug=1` API** exposing `CF.simulate(record)` and `CF.conditions()`, so
  the determinism guarantee is permanently testable rather than asserted.
- **[The online specification](./multiplayer-spec.md)** — input records, async
  turn-based model, Cloudflare stack with schema and endpoints, the match state
  machine, anti-cheat by server re-simulation, and the float-determinism risk.

### Verified
40 input records spanning every keeper tier, both wall configurations and spots
from 11m to 45m replay **40/40 identically** when reordered on the same page and
**40/40 identically** in a fresh browser context, agreeing to nine decimal
places on ball rest position. Two players at the same kick index get identical
wind and weather; consecutive indices differ. The determinism gate for Stage 4
is passed — for Chromium. Cross-engine agreement on iOS Safari and Android
Chrome is explicitly still unmeasured, and Stage 4 must measure it before
matchmaking is built.

---

## Stage 4 — Online, Accounts and Hardening

**Goal.** Ship the thing Stage 3 specified, and make the whole game
production-solid.

### 4.1 Accounts
- **Play first, sign up later.** Anonymous device accounts from the first kick,
  upgradeable to a real account without losing anything. Forcing signup on a
  casual flick game is how you lose most of your players.
- Email magic-link or OAuth. No passwords to manage.
- **Profile migration** from `localStorage` to server, with explicit conflict
  resolution when a device has local progress and the account has more.

### 4.2 Online play
Matchmaking within rank bands; friend challenges by share link; async matches
with a turn timer; leaderboards (global, friends, weekly); the economy resolved
server-side after re-simulation.

### 4.3 Bug hunt and hardening
This is a real workstream, not a line item.

**Committed regression suite.** The Playwright scripts written throughout
Roadmap I were throwaway; they become a checked-in suite: mode smoke tests,
balance sweeps with tolerance bands, the determinism check, and a
no-console-errors gate.

**Device matrix.** iOS Safari (touch, audio unlock, safe-area insets, 120Hz
displays), Android Chrome, desktop, and small/short viewports.

**Known risks, from what has already bitten during development:**
- Audio autoplay policy — the context needs a user gesture; the ambient bed must
  not fail silently.
- `devicePixelRatio` memory on large/high-DPI screens (currently capped at 2.25;
  needs verifying under memory pressure).
- `localStorage` blocked in private mode — already guarded, needs a test.
- Background rebuild cost when switching modes or spots rapidly.
- **Float determinism across JS engines** — the single biggest risk to the
  online model. Must be measured on real devices, not assumed. If it fails,
  fall back to server-authoritative simulation with the client as a viewer.

**Accessibility.** Reduced-motion support; scalable text; keyboard play. And a
specific one: the umpire flags are **green, white and orange**, and the score
pips reuse those colours — that is close to worst-case for red-green colour
blindness. Add shape or label differentiation, not just hue.

**Telemetry**, aggregate and privacy-respecting: conversion by spot, mode
popularity, drop-off points — to drive balance with data instead of guesses.

### 4.4 Recommended features
Additions worth building once the above is in place:

- **Shareable replays.** The flight is already recorded and an input record is
  tiny — "watch my goal" becomes a link, not a video upload.
- **Turn notifications** for async matches (web push).
- **Practice range**: any spot, any conditions, instant reset, no scoring.
- **Clubs**: player groups with shared weekly totals (sets up Stage 5).
- **Spectate** a friend's match replay after it resolves.

### Acceptance criteria
- A full async online match completes between two real devices.
- Server rejects a tampered input record.
- Regression suite runs green in CI; no console errors on any supported device.
- Anonymous → registered upgrade loses nothing.

---

## Stage 5 — The Living Season

**Goal.** Turn a game people finish into one they open every week — and make it
possible to feed it new content without an engineering release each time.

### 5.1 Seasons and ladders
Six-week seasons with placement matches, rank decay, and a seasonal reward
track earned purely through play. No paid track — consistent with the
virtual-only economy in the ground rules.

### 5.2 Daily and weekly challenges
The determinism work from Stage 3 makes these nearly free: everyone in the world
faces an **identical** seeded set of kicks — same wind, same weather, same
keeper behaviour — with a leaderboard and a shareable result card. This is the
strongest retention mechanic available and it costs almost nothing once seeded
randomness exists.

### 5.3 Content as data, not code
Move venues, kits, spot sets, challenge definitions, rank tables and economy
numbers out of source and into **JSON manifests loaded at runtime**, with an
in-repo authoring and validation script. New grounds, kits and challenges then
ship without a code deploy — which is the difference between a game that gets
updated and one that does not.

### 5.4 Clubs
Players form clubs, contribute to weekly club totals, and clubs draw against
each other. The social hook that makes people come back for someone else's sake.

### 5.5 Live ops
- **Remote config** for balance — tune keeper reach or payout curves without a
  release.
- Staged rollout and kill-switches for new modes.
- An admin dashboard. The repo already has `pipeline.html` as a precedent, and
  the same auth layer can gate it.

### 5.6 Keeping quality from drifting
- A **balance canary** in CI: run the sweep harness on every PR and fail the
  build if conversion rates move outside their tolerance bands. Balance
  regressions are invisible in code review and obvious in a table.
- An enforced performance budget checked on a real mid-range device.

### Acceptance criteria
- Two players running the same daily challenge face provably identical
  conditions.
- A new venue and a new kit can ship with no code change.
- Balance canary catches a deliberately introduced regression.

---

## Sequencing notes

- **Stage 1 has a hidden dependency**: the kicker figure. Without it the kit
  economy has no shop window.
- **Stage 3's seeded PRNG is the keystone.** Local fairness, the entire online
  model, and Stage 5's challenges all rest on it. If schedule pressure hits,
  protect that work before anything else in this roadmap.
- **Stage 4 must not start** until the determinism proof in Stage 3 passes on
  real devices. Discovering float divergence after building matchmaking is the
  most expensive failure available here.
- Stages 1 and 2 are independent of each other and could run in parallel.
