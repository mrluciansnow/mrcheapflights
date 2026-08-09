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
| 4 | Online, Accounts and Hardening | **Backend shipped** · client wiring outstanding |
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

### What shipped

**The gate, cleared by removing the risk rather than measuring it.** The spec
flagged `Math.sin/cos/atan2/pow/hypot` as implementation-defined and therefore a
threat to cross-device replay. Rather than test six devices and hope, the
outcome path no longer calls them: `hypot` became `sqrt` of a sum of squares,
`atan2` and its trig pair dropped out of the launch entirely (cos and sin of the
aim angle come straight from the triangle), `pow(x,2)` became `x*x`, and the
remaining `sin`/`cos` are an 11th-order polynomial using only `+ - * /`.
Determinism now follows from the IEEE-754 spec instead of from luck. Cosmetic
code still uses the native functions.

**Server-side simulation.** `functions/_lib/sim.js` is the server's copy of the
physics, with the PRNG draw order — wind, keeper reaction, contact slip, keeper
read — as part of the contract.

**The API**, as Pages Functions on the existing D1 binding:
`POST /api/mp/match` (create or join), `POST /api/mp/turn` (submit a record),
`GET /api/mp/:id` (poll and settle). Migration `0006_multiplayer.sql` adds
players, matches, turns and a ledger. Anonymous device accounts from the first
kick, hashed before storage, claimable by email later.

**Committed test suite** (`npm test`, `npm run test:api`) replacing the
throwaway scripts.

**Accessibility**: score pips now encode outcome in *shape* as well as colour
(goal square, two-pointer diamond, point circle) because green/white/orange
flags are close to worst case for red-green colour blindness, plus
`prefers-reduced-motion` support that also calms the camera shake.

### Verified
- **Simulation parity:** 120 records across all four tiers, both wall states,
  spots from 11m to 47m and every weather state produce **120/120 identical**
  outcomes between the Node server module and the browser build.
- **API, against a real Workers runtime and local D1: 18/18 green** — including
  that a client-claimed outcome is ignored, a client-supplied seed cannot change
  the match, out-of-order and replayed kicks are refused, a third player cannot
  read a match, and polling a settled match does not pay twice.

### Still outstanding
- **Client wiring.** The game still plays entirely offline; the online match
  flow, inbox and account-claim UI are not built, and `awardXP`/`credit`/`debit`
  still mutate locally rather than calling the API.
- **Cross-engine measurement.** The maths change makes divergence very unlikely,
  but it has still not been *measured* on iOS Safari or Android Chrome — only
  Chromium is available in this environment. Worth confirming before ranked play.
- Matchmaking is a simple first-waiting-match queue, not rank-banded.
- Turn timers, push notifications and leaderboards.

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

---

# Upgrade pass — twenty changes

Shipped alongside the roadmap stages rather than as part of one. Grouped by
what they touch; the ones marked **fix** were defects found while measuring,
not features.

## Gameplay

1. **Read the keeper.** Every kick already drew a reaction time from the
   seeded stream; nothing showed it. His set position now encodes it — a
   keeper on his toes sits low and shifts his weight quickly, a flat-footed
   one stands tall — with a label above his head. Display only: it reads the
   number that was already drawn and creates no new randomness, so server
   re-simulation is untouched.
2. **Daily Challenge.** The date seeds the placements, wind, weather and
   keeper, so everyone playing on a given day faces the same five kicks. No
   server involved — the seeded stream already guaranteed this was possible.
   Best score for the day is kept and shown on the menu button.
3. **Training Ground.** Every spot in the game, unlimited kicks, no money, no
   points, no rank. Somewhere to find out what 40% power actually does.
4. **Aim line is now optional, and turning it off pays.** Every score is worth
   25% more points with the preview off. That is an XP-side multiplier only,
   so it never touches the outcome path.

## UX

5. **Keyboard controls.** `←/→` aim, `↑/↓` power, `Q`/`E` curl, `Space`
   strikes, `Esc` pauses, `M` mutes. The drag is a phone gesture; on a laptop
   it was fiddly, and for anyone who cannot make a precise swipe it was a wall.
6. **Pause.** Until now the only way out of a shootout was to finish it.
   Resume, restart, settings, or quit, from a button or from `Esc`.
7. **Coach marks.** Three cards on the very first kick of a new profile —
   pull back, aim across, hook it — then never again.
8. **Haptics** on contact, goal, save, woodwork and promotion.
9. **Focus rings on every control**, so the keyboard path is actually visible.
10. **Play again** on the end screen, instead of routing back through the menu.

## UI

11. **Settings screen**: sound, vibration, aim line, left-handed layout, and a
    three-way graphics tier. Stored under their own key so a profile reset
    does not take them with it.
12. **Left-handed layout** mirrors the meter, readout, pause and mute buttons.
13. **Opponent pip row** — **fix**. The centre block only ever read from the
    player's own results, so half of every shootout was missing from the
    scoreboard.
14. **Round bar rebuilt** — **fix**. One long line pinned across the full
    width ran underneath the DIST and WIND gauges at every phone size. It is
    now two lines inside the channel between them, and truncates instead of
    colliding.
15. **Live aim readout** in metres beside the power and curl numbers.
16. **Bet note gutter and scoreboard truncation** — **fix**. The wager
    sentence was cut off at both stage edges; a long county name was hard-cut
    mid-word, and in the right-hand column it lost the start of the name.

## Design

17. **Trophy cabinet.** Ten awards existed and were completely unviewable.
18. **Promotion is a moment**, not a toast that slides past mid-celebration —
    a full screen that holds the game until it is acknowledged. Building it
    surfaced a **fix**: a rank earned *inside* `endMatch()` — from winning the
    All-Ireland, or from a faultless shootout — was never shown there, because
    `endMatch` does not call `advance()`. The promotion sat in `pendingRankUp`
    and appeared at a random moment in the player's *next* match, possibly in
    a mode that banks nothing at all. Every exit from `endMatch` now goes
    through one reveal that celebrates it on the spot.
19. **Kick-by-kick scorecard** on the end screen, with the umpire's flag
    against each kick and the opponent's answer beside it.
20. **Outcome legend** on the title screen, and shape as well as hue on every
    pip, so colour is never the only signal.

## Graphics

Folded into the twenty above where they overlap, and shipped together:

- **Crowd reaction** — the terracing is baked into the static backdrop, which
  makes it cheap but also dead. A thin live layer now puts phones and flags up
  over the stand for a couple of seconds after a score.
- **Floodlight bloom** that breathes with the camera and lifts on the flash,
  rather than being frozen into the backdrop.
- **Persistent pitch scuffs** — every strike and bounce leaves a mark, so the
  goalmouth is chewed up by the end of a round.
- **Ball motion smear** above 13 m/s, along the direction of travel.
- **Time of day per venue** — dusk skies and warm low light at Thurles and
  Castlebar, flat afternoon at Killarney and Clones, floodlit night at Croke
  Park and Páirc Uí Chaoimh.
- **Graphics tiers** drive device pixel ratio, crowd density, turf grain, rain
  count and bloom together, so an older phone can choose frame rate over pixels.

## Verification

- 57-check headless smoke suite: boot, every control wired, settings
  round-tripping through storage, coach marks, pause, keyboard aiming, a full
  quick match to full time, the scorecard, opponent pips, play again, daily,
  training. All passing, no runtime errors.
- Layout measured at 360×640, 420×860 and 540×940 for box overlap and text
  clipping — that is how items 14 and 16 were found.
- `npm test` still reports server/client parity 120/120 and determinism 40/40
  identical, so none of this moved the online contract.
- `tests/daily.mjs` runs the daily board in two independent browser contexts,
  with different profiles, and compares all five kicks — the claim that the
  date alone fixes the board is measured, not asserted.

Run with `npm test` (physics), `npm run test:ui` (interface and layout),
`npm run test:daily` (the shared board) and `npm run test:api` (the
multiplayer endpoints).

---

# Second upgrade pass — the six fixes, and twenty changes

Six things were named directly; the twenty below are how they were delivered
plus what came with them. Anything touching the flight had to land identically
in `game.html` and `functions/_lib/sim.js` or online play desynchronises, so
the physics went first and everything else was built on a green parity run.

## The seeded draw order changed

The contract is now:

    wind (2) -> keeper reaction (1) -> keeper lean (1) -> contact slip (1)
    -> keeper read (2)

`elev` is a new optional field on the input record. Left undefined it falls
back to `power`, which reproduces the old power-coupled flight exactly, so
records written before this replay unchanged — `tests/sim-parity.mjs` covers
both the supplied and the omitted case.

## Aiming

1. **Elevation is its own axis.** `power` used to decide how hard *and* how
   high, which meant a low driven shot did not exist: every hard strike was
   also a high one. The drag now reads three things — length is power, the
   sideways component is aim, the vertical component is elevation — and
   `shotParams(power, elev)` keeps them apart.
2. **The aim response is curved**, not linear in screen pixels. A 20-pixel
   wobble used to move the ball three quarters of a metre at the goal line.
   It is soft either side of centre and firm out at the posts, and reaches
   ±4.2m so you can aim outside a post and bend it back.
3. **Contact scatter re-tuned** to `0.30 + power*0.85` — a placed shot is
   placeable, a rocket still strays — and **drawn as an accuracy cone** at the
   reticle, so the risk of a harder strike is visible rather than felt.
4. **An aim reticle on the goal itself**, always on. It shows intent: where
   the ball crosses with no wind, no curl and a perfect strike. The dashed
   flight prediction stays optional, and still pays 25% more points when off.
5. **Elevation is named on screen** — low & hard / driven / level / floated /
   lofted.

Measured after the change (220 seeds a cell, penalty spot): elevation ≤0.55 is
goal territory, ≥0.70 clears for a point, and the seam between them is the top
corner. Best available corner by tier: Junior 100%, Intermediate 97%, Senior
76%, All-Ireland 34%. An earlier cut had a dead band at elevation 0.75–0.95
that returned nothing at all at any aim; widening the launch angle from 9–20°
to 8–26° at close range fixed it.

## Wind

6. **A strength bar and plain English** in the gauge — CALM / LIGHT / FRESH /
   STRONG, and L→R or R→L — instead of a bare number and an arrow that told
   you the wind existed but not what it would do.
7. **Endline flags** either side of the goal that stream with the wind and
   snap harder the stronger it blows, so the wind is readable in the same
   frame as the shot. They were first placed at ±9.5m, which is off the side
   of a phone; measuring the projection moved them to ±5.0m.
8. **A drift arrow** from the intent reticle to the predicted crossing point.
   The gap between the two *is* the wind plus your curl, drawn.

## Curl

9. **The measure now follows the finger.** It used to average the bow of the
   whole drag away from its chord, so the first half of a long straight pull
   diluted a late hook to almost nothing — you could turn hard and watch the
   number barely move. It measures the turn between the first and second half
   of the swipe instead, so correcting mid-drag does what it looks like it
   should.
10. **The gesture is drawn**: your finger's path, the straight chord it would
    have taken, and the trail turning blue once the bend is real.
11. **A curl dial** filling out from centre in the direction the ball will bend.

## Reading the players

12. **The keeper leans before the kick.** A seeded weight shift of up to 0.75m,
    and his dive starts from there. Measured: shooting *with* his lean scores
    15%, *against* it 25%, at the same corner — so reading him and going the
    other way is worth something and going with him is punished.
13. **The kicker opens his stance toward the target** as you aim, and his
    swing comes across the body when the shot is aimed away from his standing
    foot. There is now something to read on both sides of the ball.
14. **The kicker wears the shooting county's colours** — *fix*. He always wore
    yours, even when he was the opposition. Nobody noticed while you never
    looked at him; standing in goal you look at nothing else.

## Playing in goal

15. **The opponent's kick is now yours to save.** A new `ST.KEEP` state hands
    you the gloves for 3.2 seconds: touch the goal to place your dive, or use
    the arrow keys and space. Committing before he strikes is the whole cost —
    the keeper cannot wait and see and neither can you.
16. **Your glove radius is drawn** at the dive you have chosen, so a near miss
    is not a mystery.
17. **Saves are recorded** — a save percentage on the menu and in the
    end-of-match stats, and a *Shot Stopper* award for three saves in a match.
    Off by default? No: on, and switchable in Settings.

Only the opponent's kicks are affected, and only local ones — your own kicks
are what the online record contains, so server re-simulation is untouched.

## The shop

18. **Shelved by county.** Your county's shelf first (the pattern kits, which
    render in whatever county you have picked), then that county's own
    heritage kit pulled out and marked, then everyone else's, with an
    owned/total count per shelf.
19. **Goalkeeper jerseys** — six of them, worn by your own keeper. His shirt
    was a hard-coded hi-vis yellow, which meant the one player you stare at
    while defending had nothing to buy.
20. **Match balls** — six finishes including one panelled in your county
    colours. Cosmetic only: every ball flies the same, and the shop says so.

## Verification

- `npm test` — server/client parity 120/120 with elevation covered in both the
  supplied and omitted form, 6/6 malformed records rejected, determinism 40/40.
- `npm run test:ui` — the smoke suite grew sections for the aim axes, the curl
  measure (straight / hooked / mirrored), the wind readout, the whole keeper
  flow, and the shop shelves. Layout still clean at three screen sizes.
- `npm run test:daily` — the shared daily board still identical across two
  browser contexts.
- A balance sweep over elevation × aim × power × tier, which is how the dead
  band and the flag placement were both caught.

---

# Third pass — the aiming system, rebuilt

The pull-back is gone. You no longer wind up a slingshot behind the ball; you
draw the shot you want and it goes where you drew it.

## One gesture, four numbers

    direction   where the finger is heading as you release   -> the line
    speed       how fast you moved                           -> the pace
    length      how far the swipe travelled                  -> the loft
    curvature   how much the path bent                       -> the bend

So a quick short flick is a low drive, a long slow sweep is a lob over the
bar, and a fast curved swipe is a driven curler. Nothing is inverted any
more — the old model asked you to pull right to send it left, which needed a
coaching card to explain and never stopped feeling backwards.

The four values the physics reads (`power`, `aimM`, `elev`, `curl`) are
exactly the same four as before, only derived differently, so the input
record, `functions/_lib/sim.js` and every parity guarantee are untouched.

Implementation notes worth knowing:

- Samples carry timestamps, and pace is measured over a **110ms window** with
  a floor on the interval, because a burst of same-tick pointer events is not
  a gesture and would otherwise read as infinite speed.
- The line comes from the **tail** of the swipe, not the whole thing, which is
  what makes correcting halfway through actually work.
- A swipe going away from the goal, or one too short to read, is not a shot.
  It costs the clock, not the kick.

## The shot clock

Five seconds. The bar sits under the rank strip and turns pink under a third.
Run it down and he takes it on anyway — 22% power, level, wherever you were
pointing — because a penalty is not a puzzle you get to solve at leisure.
Training has no clock, since that is where you are meant to dither. The clock
stops for a pause, a promotion screen and the coaching cards.

## The target area

Six panels inside the frame plus the band over the bar. The one your shot is
heading for **lights up and pulses** as you swipe, with the precise crosshair
and the accuracy cone still on top of it — the zone is what you can read at a
glance while your thumb is moving, the crosshair is for the last adjustment.

Heading outside the posts used to light nothing at all, which reads exactly
like a preview that has stopped working. The post you are missing now flashes
with **WIDE** written across it.

## The keeper, the same way

Picking a pixel on the goal was a different verb from taking a shot. Diving is
a swipe too now: across for a low dive to that side, up and across for full
stretch into the corner, straight up for a leap down the middle, and a short
swipe keeps you near your line. The area you would cover lights up in the same
six panels, with your glove radius drawn on it, and the save clock is
unchanged at 3.2 seconds.

## What this cost, and what it caught

- The gesture probes had to move to the **training ground**. Run against a
  shootout they were racing the shot clock and the keeper's turn, and half of
  them were reading stale values from the previous probe — which is exactly
  the kind of green-looking nonsense that hides a real regression.
- The layout probe found the **shot clock sitting directly on top of the stake
  chips** — both pinned at 158px. The clock took the slot, the wagering moved
  down, and the probe now watches those pairs.
- It also had to learn two things: that an element with `text-overflow:
  ellipsis` is *allowed* to truncate, and that an element at zero opacity
  cannot collide with anything. Both were producing failures that were about
  the probe rather than the page.

## Verification

`npm test` (parity 120/120, determinism 40/40), `npm run test:ui` (smoke and
layout), `npm run test:daily`, `npm run test:balance`. The smoke suite gained
sections for pace-versus-loft independence, direction, the lit zone, going
wide, the curl sign, and the clock running down to a rushed strike.

---

# Fourth pass — the keeper half, and twenty around it

## Why the goalie half was a coin toss

Not a tuning problem. A structural one: `cpuShoot()` chose the shot *after*
`commitKeep()` had already locked in your dive. There was nothing to read in
the window because the shot did not exist yet. Any indicator built on top of
that would have been decoration.

The shot is now chosen the moment the turn changes over — `cpuPlan()`, same
draws in the same order, just earlier — so the window has something to show.

## What the keeper is shown

**The ring.** From the moment the window opens, a pulsing amber sight labelled
AIMED at the point his current line would cross. It first took the striker's
county colour, which was fine until the county was Kerry green and the
backdrop was a white net — both markers now have fixed, unambiguous colours
with a dark rim under them: amber for where he is aiming, pink for where it
finishes.

**The swerve flash.** If he has actually wrapped his foot around it
(`swerve >= 0.30m` of lateral movement), then between 40% and 72% of the way
through the window a second marker strobes at the true finishing point, joined
to the ring by a curved arrow and labelled SWERVE. One audio cue and one buzz,
once. If the shot is straight there is no flash — the ring was the truth.

**Your read is imperfect, on purpose.** Both markers are offset by an error
drawn from the striker's quality: 0.16m against a junior, 0.62m against an
All-Ireland forward. It comes from its own stream keyed off the match seed, so
it is fair and repeatable without disturbing the draw order the simulation
contract depends on.

The window went from 3.2s to 3.6s and now scales with the tier — a junior
gives you 1.15× of it, an All-Ireland forward 0.88×.

### Measured

Three keepers faced the same senior kicks, 14 each:

| how they dived | kept out |
|---|---|
| blind, at random | 14% |
| reading the ring and the swerve flash | 43% |

Three times as many saves from reading it. That is the number that says the
telegraph is information rather than decoration.

## And nineteen more

**Keeper**
- A dive commits: the body leans further for a corner than for a routine stop,
  the trailing leg extends, the toe points.
- He gets back to his feet once the ball is dead instead of lying in the shape
  he landed in.
- **A catch and a fingertip no longer look identical** — a save gathers the
  ball dead in his gloves, a tip deflects it away spinning. Both used to fling
  it off on the same random vector.
- A short motion trail behind a committed dive.
- The saves you have made sit on the keeper bar while you are defending.

**Kicker**
- The plant foot bites — a divot beside the ball, which is the moment the
  strike reads from.
- The body dips into the strike and comes back up out of it.

**Ball and net**
- The shadow has a real penumbra now: tight and dark with the ball on the
  deck, wide and faint with it at head height. It was one ellipse at a fixed
  softness whatever the height, which is most of why height was hard to read.
- The seams turn about an axis tilted by the sidespin, so a ball that is going
  to bend looks like it is going to bend.
- A second, harder highlight from the floodlights at the night grounds.
- The net takes the ball as a **pocket that punches in and settles**, with a
  shiver running out of it, rather than a ring on a drumskin.

**Camera**
- A held beat — 0.3× speed for three quarters of a second — on a save and on
  the woodwork. Applied only from `award()`, which runs after the outcome is
  already decided, so the physics it slows is the ball rolling away rather
  than the ball arriving. It cannot move a result.
- The camera flinches along the line of the strike and settles.

**Mechanics**
- **The striker reads you back.** Dive the same way twice running and he backs
  himself to go the other side — a nudge to his aim rather than a teleport, so
  it is a tendency you can feel and play against rather than a rule to farm.

## Verification

Parity 120/120 and determinism 40/40 throughout — none of this touches the
outcome path. The keeper measurement above is `tests/keeper.mjs`. The smoke
suite gained a section proving the shot exists before the window closes and
that what you are shown is offset from the truth rather than handed to you.

---

# Fifth pass — the keeper half, rebuilt around one clock

The last pass gave the goalkeeper a telegraph to read. It did not give him a
decision to make, and that is why it still played badly.

## What was actually wrong

Three things, and the first two hid the third.

**1. The dive did not start when you threw it.** `keeper.react` was set to a
constant at the moment you committed, and the dive was timed from that
constant. Throwing yourself the instant the window opened and waiting until
the last possible tenth produced *exactly the same dive*. There was no
decision in it — only a guess with a countdown attached.

**2. The two halves took turns.** The states ran `KEEP → CPU_WAIT → FLIGHT`:
you picked, and then he kicked. That is the wrong shape for the game and the
wrong shape for online, where two people act against the same kick without
either being able to see the other's input first.

**3. The window shut the instant he struck.** Every keeper gate asked
`state === ST.KEEP`, and that state ends at contact. So the only dive you
could ever throw was one committed *before* the ball was hit — which, once
the striker started reading early commitment, was the one dive guaranteed to
be punished. Both halves of the decision were closed at once.

## One kick, two sides, one clock

`kickT` starts at zero when the window opens and runs through the wind-up, the
strike and the flight. `strikeT` records the instant of contact on that same
clock. Everything either side does is stamped against it.

```
kickT   0 ─────────────── strikeAt ──────────── ball on the line
        │                     │                        │
striker │   winds up          │ strikes                │
keeper  │   shuffles, may throw himself at any point   │
```

- The striker hits it at `cpuShot.strikeAt` (1.45–2.30s, drawn from the seeded
  stream), **not** at a fixed beat, so you cannot wait for a known instant.
- The keeper may commit anywhere in that whole span, right up until the ball
  is 0.45m from the line. `keepLive()` — not a state test — is what every
  keeper gate now asks, in `down`, `move`, `up`, the keyboard handler, the
  preview drawing and the debug hook alike.
- Not committing is a real choice with a real cost: he stays rooted. Nothing
  dives on your behalf.

## The decision, and what each side of it costs

**Go early.** You cover the ground. `diveDur(k)` scales with how far he has to
travel — `k.dur * (0.46 + 0.88 · clamp(travel/2.6, 0, 1.35))` — so the far
corner is only reachable if you leave in time. But the forward is watching:

```js
const lead = cpuShot.strikeAt - keeper.diveAt;
const seen = clamp((lead - 0.16) / 0.62, 0, 1);
const sees = READS_KEEPER[difficulty] * seen;
aimM = lerp(aimM, away * 2.65, sees);
```

The first version of this punished *any* pre-strike commit in full, which
turned the telegraph into a trap: read the ring, go, be beaten every time —
measured at **0% saves**, worse than diving at random. It is now scaled by the
lead you gave him. Leave a full second early and an All-Ireland forward puts
it the other side almost every time; leave a fifth of a second early and the
boot is already through the ball and he barely registers it. `👁 HE CAN SEE
YOU` sits under the bar for exactly as long as leaving would still be read.

**Go late.** Once it is struck he cannot react to you at all and the flight is
honest. But there is very little ground left to cover in.

## Measured

`tests/keeper.mjs` was rewritten to play all four combinations — early/late ×
blind/read — against the same kicks at senior:

| | dive at random | dive at the read |
|---|---|---|
| **before the strike** | 29% | 43% |
| **after the strike** | 14% | 50% |

Reading the shot is worth **36 points** if you go late. Neither timing
dominates — 43% against 50% — so it is a choice, not a solved line. Nothing
reaches 85%, so the striker still has a game.

## Two gestures, because there are two decisions

Where to stand and when to go:

- **drag slowly** — shuffle along your line, ±1.25m, free, and it shortens the
  dive on that side. Only legal before the strike; there is no shuffling once
  the ball is away.
- **flick** (`> H·1.15 px/s`) — throw yourself. The same speed distinction the
  shooting half already makes, so the hand already knows it.

The bar carries the whole timeline: `HE STRIKES IN` counting down to contact,
then `BALL AWAY` counting the ball down to the line, with the prompt handing
over to *"Ball away — throw yourself"* rather than going silent at the exact
moment there is still a dive to throw.

## The foundation online needs

This is the same pass, not a follow-up: the shape the duel now has *is* the
shape two-sided play requires.

**A source seam.** `srcStriker` and `srcKeeper` are each `'local' | 'ai' |
'remote'`. `'ai'` and `'local'` are implemented; `'remote'` is a declared seam
on the same clock with the same commit shape — the input arrives over a
connection instead of from a thumb, and nothing in the resolution asks which
it was.

**A record that carries both sides.** The striker's four numbers were always
there. The keeper's dive joins them:

```js
dive: { x, y, at }   // where he went, and when — relative to the strike.
                     // Negative `at` means he had already gone.
```

Absent, the server plays its own keeper, so every record written before
two-sided play still replays byte-for-byte. Present, it resolves the duel the
two players actually had. `functions/_lib/sim.js` mirrors it exactly,
including stepping the keeper once up front when `dive.at < 0` so a dive
already under way at contact is part-way through at `t = 0`, and
`validateRecord` rejects out-of-range `x`, `y` and `at`.

That is the whole of what online needs at this layer: **one kick index, two
submissions, one authoritative outcome**, with neither side able to see the
other's before its own is in.

## Two HUD collisions found while looking at it

- The rank strip and the cash chip ran underneath the wind gauge — the money
  was drawn straight across the wind speed. `.rankbar` now keeps 88px of
  clearance, and swaps sides with the gauge in left-handed mode.
- The `REPLAY` badge was drawn through the rank strip. Moved to `H·0.195`.
- The `keepbar` was never hidden again after the first keeper turn — a leak
  from the previous pass, where the line that removed it was replaced by the
  line that relabels it. It is now cleared with the kick.

## Verification

- Parity **120/120**, malformed records **8/8** rejected, determinism
  **40/40** — with half the parity records carrying dives before, on and after
  the strike.
- Smoke suite: all passing, with two new assertions — that the gloves stay
  live after he strikes so a late dive is possible, and that the bar says
  `BALL AWAY` when they do.
- Layout probe clean at 360×640, 420×860 and 540×940.
- Balance sweep unchanged: junior 100% / intermediate 97% / senior 92% /
  All-Ireland 64% at the best available corner.

One test bug fixed on the way: the shot-clock assertions slept 5.7s of wall
time to observe a 5.0s in-game clock. A frame is capped at 33ms of simulated
time, so a loaded machine drops frames and in-game seconds run slower than
real ones — under load the test reported a working clock as a broken one. It
now waits on `CF.shotClock` itself. That is almost certainly the same effect
behind the intermittent smoke-suite stalls noted earlier.

---

# Sixth pass — the online foundation

What already existed was a **parallel time trial**: both players kick at the
server's AI keeper, the server re-simulates each kick, the scores are compared.
It works and it stays. But it is not the game — a kick is a duel, and there
was no server-side concept of two people being in one.

This is that foundation. `srcStriker` and `srcKeeper` have been
`'local' | 'ai' | 'remote'` on a shared kick clock since the fifth pass;
this fills in `'remote'`.

## The protocol, in three rules

1. **The server owns the seed.** Wind, weather, keeper reaction and contact
   slip all derive from `hash2(matchSeed, kickIndex)`. The seed is issued when
   the duel opens and is never accepted from a client.
2. **The client sends what the player did, never what happened.** Four numbers
   for a swipe, three for a dive. The server re-runs the same deterministic
   simulation and its outcome is the only one stored.
3. **Neither half is readable by the other player until the kick resolves.**
   Not the input, not whether it has arrived.

Rule 3 is the one that makes it a duel rather than a reaction test. Without
it the keeper simply waits for the swipe to land and saves everything.

## Why nothing streams

Determinism has been the point of the whole physics discipline, and this is
what it buys. The server does not stream a simulation to anybody. It stores
seven numbers and hands both of them to both clients once the kick is decided,
and each client replays it locally through its own physics. Two screens agree
without a single frame crossing the wire.

`tests/duel-client.mjs` asserts exactly that: both browsers replay the stored
record and must land on the server's outcome. If it ever disagrees, the two
players are watching different matches, and the test says so before they do.

## Schema — `migrations/0007_duel.sql`

No `ALTER`, only `CREATE ... IF NOT EXISTS`, so re-running the file against a
live database is a no-op. **A match is a duel if and only if it has a
`cf_duels` row**, which is what leaves every 0006 match working untouched.

`cf_kicks` is one row per kick, and it carries both halves:

| column | why it exists |
|---|---|
| `striker`, `keeper` | who is doing what, decided server-side by kick parity |
| `strike`, `dive` | the two submissions, each in its own column |
| `opened_at`, `deadline` | liveness: an abandoned kick is lost, not frozen |
| `outcome`, `value`, `xp` | server-computed, written exactly once |
| `resolved_at` | the flag redaction keys off, and the concurrency guard |

The three properties the tables guarantee, because the endpoints cannot on
their own: **blindness** (separate columns, redacted until resolved),
**idempotence** (one row per kick; a retried half writes the column it already
wrote), **liveness** (every open kick carries a deadline).

## Endpoints

- `POST /api/mp/duel` — open, or join. Three ways in, one code path:
  `{matchId}` joins that duel and no other (a friend, a rematch) and *fails*
  rather than silently pairing you with a stranger; `{join:false}` opens and
  waits; neither takes an open lobby if there is one.
- `POST /api/mp/kick` — submit your half. **Which half is decided by the
  server from the kick's roles, not by the body**, so a client cannot send a
  dive against a kick it is supposed to be taking.
- `GET /api/mp/sync/[id]` — the client's only read. Your role, your deadline,
  the score oriented to you, and every resolved kick with both halves. Never
  anything about the live kick's other side.

**Every read advances the match.** `advance()` runs on both endpoints, so a
duel cannot stall waiting on a background job — whichever player is looking
pushes it along, and if neither is looking there is nobody for it to stall.

## Two decisions worth naming

**A keeper who holds his line is not the same as a keeper who left.** Both end
with a man standing still, but only one of them means the player is still
there. An explicit `dive: null` is stored as the rooted dive and resolves the
kick immediately; silence sits on the deadline. They resolve identically *on
purpose* — timing out must never be better than deciding.

`simulate` reads an absent dive as "play the AI keeper", so silence had to be
spelled out rather than omitted. Otherwise closing the tab would hand you a
*better* keeper than deliberately standing your ground.

**Going early still costs secrecy, and the record proves it.** `dive.at` is
relative to the strike and may be negative — the keeper had already gone. The
server replays that timing exactly, so the fifth pass's whole early/late
trade-off survives the wire intact.

## Two holes the tests found

- **The server stored whatever the client sent.** A swipe carrying
  `outcome:'goal', value:3, xp:99999` was correctly ignored for scoring — and
  then written to the row verbatim and echoed back to *both* clients on
  replay. Submissions are now projected to the fields the simulation actually
  uses. Nothing you do not understand should reach the database, and so reach
  the opponent's screen.
- **Weather was the client's to choose.** The client picks it from the seeded
  stream; the server defaulted it to Clear and never checked. In a duel that
  is a fairness hole — one player could call for a dry ball and hand the other
  the rain. It is now drawn from the seed when the duel opens, stored on the
  match, and applied to every simulation whatever the client thinks it is
  doing.

A third was found by the test suite failing for the wrong reason: a stray
lobby from a manual probe got joined, which is how the *missing* targeted-join
feature announced itself.

## Verification

- `npm run test:duel` — **49 API assertions** and **28 two-browser
  assertions**, all passing against a local `wrangler pages dev`.
- The blindness section is the one to read: B is not shown the strike, is not
  told it arrived, and the swipe does not leak anywhere else in the payload.
- Liveness is measured, not asserted: a blitz duel is left to time out and the
  abandoned kick resolves to `timeout`, scores nothing, and the match moves on.
- Offline regression unaffected: parity 120/120, determinism 40/40, smoke and
  layout clean.

## What is deliberately not built yet

The transport, the seam and the protocol are done and tested. **The gameplay
wiring is not**: `Duel.onLive` / `onKick` / `onEnd` are the three callbacks the
game loop hangs off, and nothing is subscribed to them yet — the local match
flow still runs unchanged. Also outstanding: matchmaking UI, reconnect on a
kick already submitted (the transport handles it, nothing surfaces it),
presence, and a sweeper for lobbies nobody ever joined.

None of that requires inventing anything further. The hard part — what a kick
is, who owns which number, and what neither player is allowed to see — is
settled and has tests holding it in place.
