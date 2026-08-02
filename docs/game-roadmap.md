# Croker Flicks — Gameplay Development Roadmap

A five-stage plan for taking `game.html` from "a nice-looking penalty shootout"
to a game with a real skill ceiling, progression and reasons to come back.

Each stage is independently shippable: the game is playable and better at the
end of every one. Stages are ordered by **gameplay value per unit of work** —
depth before breadth, breadth before polish, polish before meta.

| Stage | Theme | Status |
|---|---|---|
| 1 | Shot Craft — raise the skill ceiling of a single kick | **Shipped** |
| 2 | The Championship — progression, stakes, persistence | **Shipped** |
| 3 | Beyond the Shootout — new ways to play | Planned |
| 4 | Matchday Feel — presentation, drama, atmosphere | Planned |
| 5 | Reasons to Return — meta, challenge, sharing | Planned |

---

## Stage 1 — Shot Craft

**Goal.** Make a single penalty a decision with depth. Before this stage every
kick was "pick a height, pick a side, hope the keeper guesses wrong" — the
outcome was mostly the keeper's coin flip, not the player's skill.

**Why first.** Nothing else matters if the core action is shallow. Progression
(Stage 2) is only meaningful if there is a skill to progress at.

### Deliverables
1. **Curl.** The shape of your drag bends the ball. A straight swipe goes
   straight; a hooked swipe curves in flight (Magnus-style lateral
   acceleration that scales with ball speed).
2. **A keeper who reads the shot.** Replaces the random pre-guess. He watches
   the first fraction of the flight, extrapolates where the ball is heading,
   and commits — with an error margin set by difficulty.
3. **Curl beats the read.** Because he extrapolates *linearly*, he is blind to
   curl. Bending the ball around a committed keeper is now the expert play.
4. **Difficulty tiers.** Junior / Intermediate / Senior / All-Ireland, varying
   reaction time, dive speed, reach, lateral range and prediction error.
5. **Shot feedback.** Strike-quality readout and a live scoring streak.

### Acceptance criteria
- A measurable skill gradient: naive shots convert noticeably worse than
  well-placed ones, and curl measurably improves conversion at high difficulty.
- The top tier is beatable but demands curl or the corners — not luck.
- Aim preview reflects the exact physics the shot will use, curl included.

---

## Stage 2 — The Championship

**Goal.** Give the shots stakes. A one-off shootout has no memory; this stage
adds a run to lose and a record that persists.

### Deliverables
1. **All-Ireland run.** Four knockout rounds — Preliminary Quarter-Final,
   Quarter-Final, Semi-Final, All-Ireland Final — each a best-of-5 shootout
   against a new county, with the keeper's difficulty tier rising each round.
   Win to advance, lose and the run is over.
2. **Persistent profile** (`localStorage`): matches, wins, titles, career
   goals/points, conversion rate, best streak, furthest round reached.
3. **County unlocks.** Eight counties to start, eight more earned by winning
   rounds; locked crests are visible but disabled.
4. **Pressure.** A `MUST SCORE` state when a scoreless kick would put the match
   mathematically out of reach, and shootouts that end the moment they are
   decided rather than playing out dead rubbers.
5. **Quick Match** retained as a standalone mode with a free difficulty choice.

### Acceptance criteria
- A full four-round run can be won and produces a title; a loss ends the run.
- Profile survives a page reload; unlocks persist.
- Matches end as soon as they are mathematically decided.

---

## Stage 3 — Beyond the Shootout *(planned)*

**Goal.** The penalty is one kick. Gaelic football has a whole vocabulary of
set pieces — use it.

### Deliverables
1. **Free-kick mode.** Kick from anywhere on the pitch: 45s, sideline balls,
   and frees at varying angles and distances. Distance and angle become the
   difficulty dial instead of the keeper.
2. **The two-point arc.** Implement the 2025 rule — any point struck from
   outside the 40m arc is worth **2**. This is the single most authentic
   modern-GAA addition available, and it makes range a real risk/reward axis.
   Requires an orange flag for the umpires alongside green and white.
3. **Defensive wall.** Free kicks inside 40m face a wall that jumps; curl
   becomes essential rather than optional.
4. **Survival mode.** Endless kicks, difficulty ratcheting every few scores,
   one miss and it is over. The natural home for a leaderboard in Stage 5.
5. **Pass-and-play two-player.** Alternating kicks on one device.

### Acceptance criteria
- Free-kick mode reuses the existing physics and renderer with a moving camera
  rather than a second engine.
- Two-pointers score, display and flag correctly in the GAA format.

---

## Stage 4 — Matchday Feel *(planned)*

**Goal.** Make scoring *feel* like scoring in Croke Park.

### Deliverables
1. **Replays.** Store the flight path and replay goals from a low behind-the-net
   camera in slow motion.
2. **Dynamic camera.** Subtle tracking of the ball, a push-in on the strike, a
   swing to the net on a goal.
3. **Layered crowd audio.** Ambient murmur that swells on a strike and breaks
   into a roar on a goal, groans on a miss.
4. **Commentary.** Context-aware lines ("that's his third of the day", "he has
   to score here") driven by the match state already tracked in Stage 2.
5. **Weather.** Rain and a heavy pitch: a wetter ball carries less and the turf
   darkens. Wind already exists — tie it to a visible weather state.
6. **Kit detail.** Per-county jersey patterns (hoops, sashes, halves) on the
   keeper rather than a flat colour.

### Acceptance criteria
- A goal produces a distinct, repeatable moment: shake, roar, flags, replay.
- No frame-rate regression on mobile; replays reuse recorded state, not a
  second simulation.

---

## Stage 5 — Reasons to Return *(planned)*

**Goal.** Turn a session into a habit.

### Deliverables
1. **Daily challenge.** A seeded set of five kicks — same wind, same keeper
   behaviour for everyone that day — with a shareable result.
2. **Achievements.** "Green flag from the corner", "five in a row", "beat the
   All-Ireland keeper without conceding a save".
3. **Local leaderboard** for Survival and Daily, stored alongside the profile.
4. **Share card.** Render the final scoreline to a canvas image the player can
   save or post.
5. **Site integration.** Link from the main site as a bit of brand fun, with a
   deep link back to the deals page from the full-time screen.

### Acceptance criteria
- Daily challenge is deterministic from the date seed — two players on the same
  day face identical conditions.
- Share card renders offline with no external assets.

---

## Engineering principles carried through every stage

- **One physics engine.** Every mode uses the same projectile integration and
  the same projection. Aim previews integrate the exact physics the shot will
  use, so what is drawn is what happens.
- **Collisions use true dimensions.** The ball is drawn larger than life for
  readability, but the woodwork tests against a real size-5 radius.
- **Measure balance, do not guess it.** Every change to keeper or shot
  parameters is validated by running batches of scripted shots and reading the
  outcome distribution.
- **Self-contained.** No dependencies, no external assets, works offline.
