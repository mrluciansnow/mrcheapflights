-- (Renumbered from 0006 when the game branch merged with the site's trunk:
--  both had independently reached 0006-0008. The runner records migrations
--  by full filename and adopts anything whose tables already exist, so a
--  database that applied the old name simply adopts the new one.)
-- Croker Flicks multiplayer.
-- Players start as anonymous device accounts and can claim an email later, so
-- nobody is asked to sign up before they have played.

CREATE TABLE IF NOT EXISTS cf_players (
  id            TEXT PRIMARY KEY,          -- opaque player id
  device_token  TEXT UNIQUE,               -- anonymous identity, hashed
  email         TEXT UNIQUE,               -- null until the account is claimed
  handle        TEXT,
  county        TEXT DEFAULT 'Dublin',
  kit           TEXT DEFAULT 'std',
  xp            INTEGER NOT NULL DEFAULT 0,
  money         INTEGER NOT NULL DEFAULT 500,
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cf_players_xp ON cf_players(xp DESC);

CREATE TABLE IF NOT EXISTS cf_matches (
  id          TEXT PRIMARY KEY,
  seed        INTEGER NOT NULL,            -- uint32; all conditions derive from it
  mode        TEXT NOT NULL DEFAULT 'shootout',
  rounds      INTEGER NOT NULL DEFAULT 5,
  difficulty  TEXT NOT NULL DEFAULT 'senior',
  a_player    TEXT NOT NULL,
  b_player    TEXT,
  state       TEXT NOT NULL,               -- waiting|in_progress|resolved|settled|expired
  winner      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (a_player) REFERENCES cf_players(id),
  FOREIGN KEY (b_player) REFERENCES cf_players(id)
);
CREATE INDEX IF NOT EXISTS idx_cf_matches_state ON cf_matches(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_cf_matches_a ON cf_matches(a_player, state);
CREATE INDEX IF NOT EXISTS idx_cf_matches_b ON cf_matches(b_player, state);

-- One row per kick. The primary key makes a retried submission idempotent:
-- the same kick can never be played, or scored, twice.
CREATE TABLE IF NOT EXISTS cf_turns (
  match_id    TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  kick_index  INTEGER NOT NULL,
  record      TEXT NOT NULL,               -- the submitted input record, verbatim
  outcome     TEXT NOT NULL,               -- server-computed; never client-supplied
  value       INTEGER NOT NULL DEFAULT 0,  -- 3 goal / 2 two-pointer / 1 point
  xp          INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id, kick_index),
  FOREIGN KEY (match_id) REFERENCES cf_matches(id)
);

-- Every currency movement is a ledger row, so a balance can always be
-- rebuilt and a double-credit is detectable.
CREATE TABLE IF NOT EXISTS cf_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  match_id   TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES cf_players(id)
);
CREATE INDEX IF NOT EXISTS idx_cf_ledger_player ON cf_ledger(player_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_ledger_once
  ON cf_ledger(player_id, match_id, reason) WHERE match_id IS NOT NULL;
