# Croker Flicks — engine test pass

A survey of the gameplay engine, single player and multiplayer, looking for
faults in aiming, kicking, saving, physics and graphics.

Everything below is **measured**, not inspected. Sample sizes are stated
because the difference matters: an earlier change in this project was tuned
off a 14-sample browser sweep and came out roughly 8× wrong. The pure-sim
harnesses used here run 2,000–20,000 kicks a cell in a few seconds, and the
browser is used only for things that only exist in a browser.

**Multiplayer transport is healthy**: 285 checks across nine suites
(`duel-api`, `duel-client`, `duel-play`, `duel-lobby`, `duel-queue`,
`duel-room`, `duel-endgame`, `duel-talk`, `mp-api`) all pass against a local
Pages server. The multiplayer findings below are about the *game* being played
over that transport, not the transport itself.

---

## Fixed in this pass

### 1. The aim aid lied about the woodwork

**The one instrument the player has was telling them the opposite of what
happens.**

The reticle decided "is this in the goal?" with `centre height < crossbar
height` — ball and bar both treated as points. The game does not score it that
way: `evaluateAtPlane` calls it woodwork when the ball's centre passes within
a ball-and-a-post of the frame. That is a band **39cm tall** under the bar and
**19.5cm wide** inside each post.

So there was a 39cm strip where the reticle lit up yellow, said GOAL, and the
ball came back off the crossbar. Measured at power 0.78:

| what the aid said | ball centre | what actually happened |
|---|---|---|
| GOAL | 2.240m | goal 100% |
| GOAL | 2.380m | **bar 100%** |
| GOAL | 2.450m | **bar 100%** |
| point | 2.520m | **bar 100%** |
| point | 2.589m | **bar 100%** |
| point | 2.728m | point 76% |

2,000 kicks a row. With only ±4cm of contact scatter, a player in that band
hit the bar every single time and had no way to learn why.

**Fixed**: the aid now uses the same geometry as the scorer. The frame lights
up orange and says OFF THE CROSSBAR / OFF THE POST. `tests/aim.mjs` judges
2,497 real flights and requires the aid's verdict and the game's outcome to be
the same word — currently zero disagreements.

The warning band it produces (elevation 0.48–0.57 at power 0.78) matches the
measured bar band exactly, with a clean goal below it and a clean point above.

### 2. The parity suite could not see a changed keeper

`tests/sim-parity.mjs` is the anti-cheat's safety net: it exists to catch the
client and server disagreeing about physics. During this pass the two copies
were genuinely given different values for the top tier's dive range — and the
suite passed **120/120** over it.

Its records are broad and random, and broad-and-random misses narrow things:
only a handful were both played by the server's own keeper *and* aimed near
the limit of his reach.

**Fixed**: 88 records added that go at the numbers directly — every tier, aims
stepped across and past each tier's reach, driven hard and low. Re-running the
divergence with those in place fails 2/208 as it should. Suite is now 208
records.

### 3. `simulate()` reported the wrong point

The returned `x`/`y` was the ball's position *after* the step that crossed the
line — up to 40cm past it — while the outcome was judged at the crossing. Any
analysis reading the position back to ask "why was that a post?" got an answer
that did not match the verdict.

**Fixed**: `hitX`/`hitY` (the interpolated crossing point) are now returned
alongside. Additive, and it widens what parity compares.

### 4. The prompt ran under the pause and mute buttons

`white-space:nowrap` on a centred pill, against two 34px buttons pinned to the
bottom corners. Measured overlap during a live kick:

| device | overlap |
|---|---|
| iPhone SE 320×568 | 34×30px both sides |
| small Android 360×640 | 20×30px both sides |
| iPhone 14 390×844 | 5×30px both sides |
| Pixel 7 412×915 and wider | none |

**Fixed**: the prompt wraps and keeps their width clear. Zero overlaps at
every size tested.

### 5. One stat in the difficulty table went backwards

`range` across the ladder: 1.90 → 2.05 → 2.32 → **2.28**. Every other stat
(`rMin`, `rMax`, `dur`, `reach`, `err`) improves on every line.

The ladder still worked — saves go 22% → 33% → 47% → 56% because the other
stats carry it — so this is a consistency fix, not a balance change. Measured
cost of correcting it to 2.45: **0.007 points per kick**. Fixed anyway,
because a table that lies about which way it is tuned will mislead the next
change made to it.

---

## Found, deliberately not fixed

These need their own measured passes, or are design calls that are the
owner's, not mine.

### 6. A hard shot inside the post is free at the lower two tiers

The goal is ±3.25m. A keeper's dive is clamped to `keeper.range` and his hand
adds `reach`:

| tier | total reach | unreachable strip each side |
|---|---|---|
| junior | 2.32m | 0.93m |
| intermediate | 2.50m | 0.75m |
| senior | 2.80m | 0.45m |
| All-Ireland | 2.97m | 0.28m |

Aim 2.5m at full power, 6,000 kicks: junior **99.8% goals**, intermediate
**99.5%**, senior 93.8%, All-Ireland 61.5%. Contact slip at full power is
±0.196m — nowhere near the post at 3.25m — so there is no risk in going there.

Junior is the Preliminary Quarter-Final and intermediate the Quarter-Final, so
the first two championship rounds can be won with one memorised swipe.

Not fixed because keeper reach is the single biggest lever on every mode's
balance at once, and moving it belongs in a pass that re-measures all of them.

### 7. The crossbar band is deterministic, and that is probably correct

At every power there is a ~10-point-wide band of the elevation control that
hits the bar more than half the time, with a cell at its centre that is
**100.0% over 2,000 kicks**. Vertical scatter is ±3–5cm against a 39cm band.

The obvious fix is more scatter. It was measured, and rejected:

| slip amplitude | worst cell | top-corner goals | scatter |
|---|---|---|---|
| 0.012 (current) | 100.0% | 97.9% | ±4.2cm |
| 0.055 | 92.3% | 97.9% | ±19.2cm |
| 0.070 | 69.3% | **78.2%** | ±24.5cm |

Breaking the band costs the top corner, which is the most skilful shot in the
game. A ball struck at bar height hits the bar — that is football, and the
band is correct geometry, not a bug. What was wrong was that the player could
not see it coming, and that is what finding 1 fixed.

*(This revises the reasoning in PR #19, which added the vertical slip to
soften this band. The slip is worth keeping — it removed a deterministic
crossbar strip at the default elevation — but it was calibrated off a
14-sample sweep and is about 8× too small to do what its comment claims. The
aid is the better answer.)*

### 8. About a fifth of the striker's control surface is a guaranteed score

Searching aim × elevation × power against a live keeper: **251 of 1,235 cells
score 100% of the time**, all of them points, none goals. `elev 0.7, power
0.78` aimed straight is a point in **100.0% of 4,000 kicks** across every tier
and every weather, including driving rain against an All-Ireland keeper.

That is not the dominant strategy — a hard shot into the corner scores 2.62
points per kick against the lob's guaranteed 1.00 — but a guaranteed score is
still a floor under every shootout, and it is reachable by accident.

Largely a consequence of the same geometry as 6 and 7: a point is unsaveable
in GAA by design, so this is a question about what a point should be worth and
how easy it should be, not a bug to patch.

### 9. Multiplayer: a human keeper cannot reach the corners either

A duel keeper's dive is clamped by the same `keeper.range`. Given **perfect
information** — diving exactly where the ball will cross, at exactly the right
moment — a senior duel keeper saves:

| aim | saved |
|---|---|
| 0 to 2.2m | 100% |
| 2.4m | 99.5% |
| 2.6m | 95.2% |
| 2.8m | 77.1% |
| 3.0m | 35.2% |

So online play has a narrow optimum for the striker at ~2.9m, and a keeper who
reads the shot perfectly still concedes two thirds of them there. Whether that
is right depends on how strong the keeper's read is meant to be — a design
call, and the same lever as finding 6.

### 10. The wall is decorative beyond 20m

Free-kick mode. The wall stands 13m from the ball (the GAA distance), which at
26m and beyond is at the top of the ball's arc. Measured across every
elevation and power at 26m, 32m and 40m: **0 men and 5 men produce identical
outcomes, 0.0% blocked**. At 20m it is an all-or-nothing cliff — 100% blocked
at elevation 0.05, 0% at 0.15.

### 11. The bet bar sits across the goalmouth

Not a collision in the measured sense — it is where it was placed — but the
stakes row and its note are drawn over the goal and the crossbar at every
viewport, which is exactly where the player is looking while aiming.

---

## Confirmed working

- **Weather** is monotone and meaningful: 0.572 → 0.535 → 0.477 → 0.419 points
  per kick from clear to driving rain.
- **The difficulty ladder** works end to end: 22.1% → 33.1% → 47.1% → 55.7%
  saves, conceding 1.225 → 0.839 → 0.506 → 0.344 points per kick.
- **The aim preview** predicts the landing height to within 6cm across the
  whole power and elevation range. (An apparent 21cm error during this pass
  turned out to be two runs in different weather — a wet ball leaves the boot
  7% slower.)
- **The two-point arc** behaves: twopoints start appearing past 40m and the
  wide rate climbs with range, so distance is a real trade.
- **Curl** does a great deal — but non-monotonically, and one setting at a
  given aim is a 100% save while another is 92% wide. Sharp, but arguably
  correct: bend it back into the keeper and he catches it.

## How to re-run this

```
npm run test:game     # parity 208, determinism, physics 15
npm run test:ui       # smoke, layout, music, pressure, aim
npm run test:duel     # 285 multiplayer checks, needs a local Pages server
```

The pure-sim probes used for the survey are not committed — they are a few
lines each against `functions/_lib/sim.js` and are quicker to rewrite for the
question in front of you than to generalise.
