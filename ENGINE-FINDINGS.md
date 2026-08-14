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

### 11. ~~The bet bar sits across the goalmouth~~ — overstated, corrected

Measured rather than eyeballed, the stakes row sits about 145px **above** the
crossbar, over the uprights and the terrace — not across the goalmouth. The
first version of this finding said otherwise and was wrong.

What *was* real underneath it: the note below the stakes was white at 55%
opacity over the busiest part of the frame, which is a texture rather than a
line of text. Fixed in the second pass — it has its own ground now.

---

---

# Second pass — pacing, and the soundtrack

## 12. A third to a half of a match was watching, with no way past it

Sampling the game state 50 times a second through a whole quick match:

| state | share of the match |
|---|---|
| AIM | 36.3% |
| **RESULT** | **30.8%** |
| KEEP | 12.4% |
| FLIGHT | 11.9% |
| REPLAY | 8.6% |

The result card holds for 1.7s, slow-mo stretches that, and a goal adds a
replay on top. None of it could be dismissed: the only input handler in the
game returned immediately unless you were aiming.

**Fixed**: a tap during RESULT or REPLAY takes the shortest honest route to
the next kick. It does not skip the *outcome* — that is decided and scored
before any of it is drawn — it ends the presentation. Measured over a full
match:

| | match length | spent watching |
|---|---|---|
| before | 57.9s | 23.5s (41%) |
| tapping through | **25.7s** | **0.4s (1%)** |

A hint appears after a beat, and only once a player has watched a few — a
first goal should not come with instructions for getting past it.

## 13. The music was a loop, not a soundtrack

One sixteen-note line over one drone and one thump: the same four bars, one
chord, forever. Long enough to notice and short enough to wear through in a
minute.

**Rewritten** as a sixteen-bar tune in D dorian — four phrases (A A' B A'')
over a Dm–C–G–Dm progression, with a bass that walks between the chords, a
drone that moves with them, a bodhrán with the tipper coming back off the
beat, and a trad cut ornament on every second bar. The arrangement thins out
away from a match: a menu keeps the tune and the drone and loses the rhythm
section.

The composition is now a pure function of the beat, separate from the
scheduler. That is not tidiness — the scheduler works a second ahead of the
audio clock and cannot be driven forward by hand, so a tune that takes 45
seconds to come round could not otherwise be checked. `tests/music.mjs` is now
29 checks and reads the score directly: 32 melody notes, four distinct
phrases, resolving to the note it opened on, three or more bass roots, and
every pitched note in the mode.

# Third pass — three fixes that do not work, and why

Finding 6 said a hard shot inside the post is a free goal at the lower tiers.
It is worse than that, and the reason is not the one that document gave.

## The corner is unsaveable by construction

At full power the ball reaches the line in **0.407s**. The dive:

| tier | reacts in | dive to that corner | earliest arrival |
|---|---|---|---|
| junior | 0.25–0.35s | 0.55s | 0.80s |
| intermediate | 0.22–0.31s | 0.50s | 0.72s |
| senior | 0.19–0.27s | 0.45s | 0.64s |
| All-Ireland | 0.15–0.22s | 0.40s | **0.55s** |

The fastest keeper in the game arrives 0.15s after the ball, and the slowest
0.4s after. No amount of reach, range or reading changes that, because none of
them is the binding constraint. And a player can put it there: measured with a
clean harness, the same swipe repeated lands within **1–3cm**.

So the shootout has a repeatable, risk-free, unsaveable shot worth 2.6 points
a kick against a random 0.77. That is the real fault, and it is still open.

## Three fixes measured and rejected

**Give every keeper enough reach.** Ranges raised so all four tiers cover the
goal (2.55 → 3.10m). Corner goals moved from 100/100/94/58% to
100/100/93/56%, concedes-per-kick by 0.01. Reach was never the constraint.

**Make power cost accuracy.** The contact slip already scales with power; the
curve was steepened to ±0.57m at full power, three times what it ships with.
Corner goals 100/100/94/58% → 95/94/85/54%; the best cell on the whole control
surface 2.57 → 2.41. Almost nothing, because the spray stays INSIDE the
unsaveable band — widening it just scatters the ball across ground the keeper
cannot cover either.

**Let the keeper guess, like a real penalty keeper.** He commits at the strike
to the side his lean already shows, derived from the lean draw so the seeded
stream is untouched. It makes him **worse**: corner goals rose to 99% at
senior and 91% at All-Ireland, and the solo score doubled. A blind commitment
is worse than a late read, because a dive that is only partway there still
covers ground near the middle. A keeper who has thrown himself at a guess
covers one spot and nothing else.

What is left is the race itself, and every lever on it trades against
something already shipped — faster dives undo the commitment cost from #22,
slower balls change every mode at once. The design answer is probably that the
keeper should **adapt**: go where this player has been going. That is the AI's
target selection, which is on the outcome path and would have to be fed
identical history on both copies, so it is a protocol change and its own pass.

## An aim bug that was not there

This pass also chased, and failed to find, a fault in the swipe reading.

Measured first at a standard deviation of **1.02m** — the aim wandering across
most of the goal from one repeated gesture — it looked like the biggest
playability bug in the game. It was the harness: releasing the pointer FIRES
the shot, so every second swipe was being measured against a match that had
already moved on, and those reads came back as a flat zero. Half real numbers
and half zeros is a large standard deviation and no bug at all.

With a harness that waits for a live kick before each swipe, the aim is
repeatable to **1–3cm**.

A fix was written for the non-problem — heading and curl fitted across every
sample of the swipe rather than taken from two or three of them — and has been
reverted. Two like-for-like comparisons of it disagreed with each other
(fitted better at ±6px of jitter in one run, much worse in the next), which at
18 samples a cell is noise, and shipping an unmeasurable change to the core
input is the same mistake as the 14-sample sweep behind #19. The principle may
still be right; there is no evidence, so it does not ship.

## Not measurable in this container

**Frame pacing.** The harness reports `devicePixelRatio: 1`, so the three
graphics presets all render at the same size and cannot be told apart, and the
~25ms floor observed is the headless environment rather than the game. An
early draft of this document reported "12.77% dropped frames" as a finding;
that number is the harness and has been removed. Frame cost needs measuring on
a real device.

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

## Fourth pass — the tune answers the match

A goal, a point, a save and the woodwork each get a **sting**: a short phrase
over the top of the tune, written off the same scale degrees so it lands as
part of the music rather than as a sound effect that happens to be musical. A
goal is the tonic triad rising; a save is the same shape falling an octave
down; the woodwork is one flat note with no resolution, because nothing
resolved. All through the music bus, so they duck under a voice and stop with
the setting.

`tests/music.mjs` is 35 checks now.

# Fifth pass — the game scored a different kick from the one you watched

Reported from real play: "says hit the bar when visually it hasn't touched
it", "goal when it's a miss", "doesn't read that the goalie blocked it".

Two faults, both the same shape — the outcome and the picture came from
different places. Both measured, both fixed.

## The contact was drawn up to 28cm from where it was judged

The outcome is decided at the **interpolated crossing**: the exact point the
ball passes the goal line, worked out between the frame before and the frame
after. That part was right. What was wrong is that the ball itself was left
wherever the step had put it — already past the line, by up to 28cm, which is
more than a ball's width, and often already *behind* the goal.

So the woodwork bounce was applied from behind the goal. The player watched
the ball sail clean past the bar and then get yanked backwards into it.

Measured over real kicks through the input path: median drift 15–20cm, worst
30cm, and it scales with frame time — 17ms frames drifted less than 33ms ones.

**Fixed**: the ball is put on the crossing point before the contact response
runs. The same fault, and the same fix, applies to the free-kick wall, where a
block was judged at the wall and bounced from a body's width past it.

## The flight ran on the frame clock, the server on a fixed one

`stepBall(dt)` was called with whatever the frame handed it, capped at 33ms.
`functions/_lib/sim.js` steps at exactly 1/60. So the same swipe on a phone
holding 60fps and one dipping to 30 followed two different flights.

Through the same physics at two step sizes, 3,000 kicks:

| | different outcomes |
|---|---|
| 60fps vs 30fps | **170 (5.7%)** |
| 60fps vs 120fps | 89 (3.0%) |

And what changed is the bug report, item for item:

| flip | count |
|---|---|
| point → bar | 51 |
| tip → save | 37 |
| bar → save | 29 |
| goal → tip | 21 |
| bar → goal | 10 |
| save → tip | 10 |

A ball that is off the bar on one phone and over it on another is not a
physics engine, it is a frame counter. It also means solo play could disagree
with the authoritative copy, on a device that never dropped a frame in
testing.

**Fixed**: the flight runs on a fixed 1/60 accumulator, the same step the
server uses. Frame rate now changes how smoothly the flight is *seen* and
nothing else. A slow frame catches up in several fixed steps instead of taking
one big one.

`tests/contact.mjs` (11 checks) covers both, and joins `npm run test:game`.

## How to re-run this

```
npm run test:game     # parity 208, determinism, physics 15
npm run test:ui       # smoke, layout, music, pressure, aim
npm run test:duel     # 285 multiplayer checks, needs a local Pages server
```

The pure-sim probes used for the survey are not committed — they are a few
lines each against `functions/_lib/sim.js` and are quicker to rewrite for the
question in front of you than to generalise.

---

# Sixth pass — twenty things worth fixing

Four areas, five each. Everything in the aiming section is measured at 900
kicks a cell through `functions/_lib/sim.js` at senior; everything else is
read out of the source and cited, so it can be checked without running
anything. Nothing here is fixed yet.

## Physics

**P1. The keeper is not interpolated to the instant the ball crosses.**
`stepFlight` calls `keeperUpdate(keeper, kickT, ball)` for the whole step,
then judges the crossing at the interpolated fraction `f` *inside* that step —
but `evaluateAtPlane` reads `keeperHand(keeper)` at its end-of-step value. At
full stretch the hand covers about 0.4m in a 1/60 step, so a save can be
given, or refused, against a hand that is up to a whole step ahead of where it
was when the ball actually arrived. The ball is snapped back to the crossing;
the keeper is not. Fix is symmetrical: evaluate him at `kickT - dt*(1-f)`.
Must land identically in `functions/_lib/sim.js`.

**P2. The ball bounces off a plane 28cm above the grass.** `stepBall` tests
the ground with `CFG.BALL_R`, which `CFG` itself documents as "drawn radius —
exaggerated for on-screen readability" (0.28). Every *contact* test uses
`CFG.BALL_PHYS` (0.11, "true size 5"). One ball, two radii, and the bigger one
is the one the turf uses.

**P3. Contact is tested with the ball's centre on the plane.** The trigger is
`prevZ > 0 && ball.wz <= 0`. A real ball touches the frame and the gloves when
its *surface* gets there, one radius earlier. Every woodwork and save call is
systematically 11cm late — small, but it biases exactly the marginal calls
players argue about.

**P4. The body block is a circle where the body no longer is.**
`dBody = dhyp2(bx-keeper.wx, by-(keeper.wy+1.0))` against a fixed 0.55m, but
the drawn chest is now pelvis+spine with the pelvis dropping for a low ball
and leading toward the hand. The two can be a third of a metre apart, so a
ball can strike his drawn chest and be given a goal.

**P5. No Magnus lift, and a ball that stops bouncing never stops rolling.**
`curl` is applied along `shotR` only — purely lateral. Backspin floats a ball
and topspin dips it, and neither exists: elevation is fixed at launch and only
gravity and linear drag act after. Separately, once `Math.abs(b.vy)<0.7` zeroes
the vertical there is no rolling friction, so the ball slides on at a constant
speed forever.

## Skeleton and movement

**S1. He has no recovery.** `k.recover` is read into the pose but there is no
get-up: he unwinds back along the path he dived, in reverse. A keeper pushes
up off the near hand and reorganises his feet.

**S2. His head never looks at the ball.** It is rigidly on the spine axis. A
keeper's head is on the ball from before the strike and stays there through
the dive; it is one of the strongest cues that he is a person and not a
puppet.

**S3. The feet slide on his line.** `k.wx` interpolates continuously and the
planted foot is derived from the hip, so while he shuffles the feet translate
without ever being picked up. The classic renderer already solves this with a
`stepPh` cadence driven by distance travelled; the ink one has nothing.

**S4. Nothing happens at contact.** On a save the ball stops dead at the hand.
No glove recoil, no arm giving with it, no parry direction on a tip — the
outcome changes but the body does not react to it.

**S5. The kicker was never rebuilt.** `inkKicker` still poses limbs at
hand-set angles with `limb()`: no chain, no IK, no phase structure, no ground
constraint. It is the same class of defect the keeper had before this week,
and it is in the foreground of every frame.

## Aiming

Measured, 900 kicks a cell, senior, power 0.75.

**A1. Fifty-seven per cent of the aim range is a guaranteed save.** From 0.0m
to 2.4m the goal share runs 0–8% and the save share 80–100%. There is exactly
one band worth using, 2.4–3.0m.

**A2. That band is a knife-edge, and the punishment is asymmetric.** 2.7m pays
75% goals. 3.0m still pays 58% but adds 34% woodwork. 3.3m collapses to 11%
goals and 67% woodwork. Missing inside costs you nothing you had; missing
outside costs you the kick.

**A3. Elevation above 0.65 is a free point, every single time.** 0.7 through
1.0 return 100% point across 900 kicks each — no variance, no risk, no
decision. Roughly a third of the elevation control pays a guaranteed score.

**A4. Elevation below 0.5 does nothing at all.** 0.0, 0.1, 0.2, 0.3 and 0.4
all land within noise of each other (7–15% goal, 68–80% save). Two fifths of
the control changes nothing about the outcome.

**A5. A point can only be scored by going over the bar.** At elev 0.25 the
point share is 0% at every aim value tested. There is no placed point — no
shot the keeper gets a hand to that goes over — which is most of how points
are actually scored in the game this is modelling.

## Goalie mode and the indicator system

**G1. Offline keeper mode has no read whatsoever.** `drawTendency` returns
early unless `netTendency()` exists and `drawReadCue` returns unless
`mode === 'online'`. Against the AI you are guessing with no information at
all, which is a coin toss dressed as a decision.

**G2. Nothing arrives before the strike except the tendency.** The comment
above `drawReadCue` is right that a post-strike cue cannot be dived on — but
that leaves the pre-strike window carrying a single bar chart. A body-shape
tell in the run-up is the obvious missing piece.

**G3. The reach circle shows one of three save radii.** `drawKeepPick` draws
`keeper.reach`, but `evaluateAtPlane` also saves on `dBody < 0.55` and tips
out to `reach + 0.16`. Two thirds of the ways you can stop a ball are invisible
on the indicator that exists to show you where you can stop one.

**G4. The artifact's keeper mode charges no reaction cost.** `commitDive` sets
`keeper.diveAt = 0` — you commit and go on contact. The AI keeper pays
`react` of 0.19–0.27s. Human keeping is therefore strictly easier than the
keeping the game models, and the two modes are not comparable.

**G5. "Kept out" counts wides and woodwork as your save.** `saved++` fires on
any outcome worth no points, so a shot that misses by two metres is credited
to the keeper. The scoreline flatters, which makes it useless as feedback.
