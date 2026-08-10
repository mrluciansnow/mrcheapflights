-- (Renumbered from 0007 on the trunk merge — see 0031.)
-- Croker Flicks online duels.
--
-- 0006 gave us a parallel time trial: both players kick against the server's
-- AI keeper and the scores are compared. That works, but it is not the game.
-- A kick is a duel — one striker, one keeper, resolved together — and this is
-- the schema for that.
--
-- Three properties the tables have to guarantee, because the endpoints cannot
-- guarantee them on their own:
--
--   1. BLINDNESS. Each side's submission lands in its own column and is not
--      readable by the other until `resolved_at` is set. Neither player can
--      wait to see what the other did.
--   2. IDEMPOTENCE. One row per (match, kick). A retried submission writes
--      the same column it already wrote, so a flaky connection cannot play a
--      kick twice or score it twice.
--   3. LIVENESS. Every open kick carries a deadline. A player who closes the
--      tab loses the kick rather than freezing the match forever.
--
-- Idempotent by construction: no ALTER, only CREATE ... IF NOT EXISTS, so
-- re-running the file against a live database is a no-op. A match is a duel
-- if and only if it has a cf_duels row; matches from 0006 keep working
-- untouched.

CREATE TABLE IF NOT EXISTS cf_duels (
  match_id    TEXT PRIMARY KEY,
  kicks       INTEGER NOT NULL DEFAULT 10,   -- total kicks, alternating sides
  kick_index  INTEGER NOT NULL DEFAULT 0,    -- the kick currently open
  turn_ms     INTEGER NOT NULL DEFAULT 25000,-- how long a side has to submit
  -- Index into sim.js WEATHERS, drawn from the seed when the duel opens.
  -- Weather changes how far a ball carries, so leaving it in the record —
  -- where each client sends its own — would let one player call for a dry
  -- ball and hand the other the rain. It is the match's, like the seed.
  weather     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (match_id) REFERENCES cf_matches(id)
);

-- One row per kick in a duel. Both halves of the kick live here, and the
-- outcome is written once, by the server, from both of them.
CREATE TABLE IF NOT EXISTS cf_kicks (
  match_id    TEXT NOT NULL,
  kick_index  INTEGER NOT NULL,
  striker     TEXT NOT NULL,               -- player id taking the kick
  keeper      TEXT NOT NULL,               -- player id in goal
  -- the striker's swipe, as submitted. NULL until it arrives.
  strike      TEXT,
  strike_at   INTEGER,
  -- the keeper's dive: {x, y, at}, `at` relative to the strike. NULL means he
  -- never committed, which is a legal choice — he stays on his line.
  dive        TEXT,
  dive_at     INTEGER,
  -- opened_at + turn_ms. Past it, the kick resolves with whatever arrived.
  opened_at   INTEGER NOT NULL,
  deadline    INTEGER NOT NULL,
  -- server-computed, never client-supplied. Set exactly once.
  outcome     TEXT,
  value       INTEGER NOT NULL DEFAULT 0,
  xp          INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER,
  PRIMARY KEY (match_id, kick_index),
  FOREIGN KEY (match_id) REFERENCES cf_matches(id)
);

-- The sweeper looks for kicks that are open and past their deadline, across
-- every match at once, so it does not have to walk the match table.
CREATE INDEX IF NOT EXISTS idx_cf_kicks_open
  ON cf_kicks(deadline) WHERE resolved_at IS NULL;

-- "What am I meant to be doing?" is answered per player without a table scan.
CREATE INDEX IF NOT EXISTS idx_cf_kicks_striker ON cf_kicks(striker, resolved_at);
CREATE INDEX IF NOT EXISTS idx_cf_kicks_keeper  ON cf_kicks(keeper, resolved_at);
