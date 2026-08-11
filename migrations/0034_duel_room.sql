-- Everything that happens around a duel rather than inside a kick.
--
-- Three things arrived together because they are the same idea: a duel is two
-- people in a room, and until now the schema only modelled the ball.
--
--   READY   A match started the instant a stranger was paired, which meant the
--           first kick opened while one of them was still reading the screen.
--           A kick has a deadline, so that is not a slow start, it is a lost
--           kick. Both players now say when they are there.
--   PRESENCE  Whether the other end is still on the other end. `last_seen` on
--           cf_players already knows; this is just the duel asking.
--   TALK    Text, and the handful of WebRTC messages two browsers need to say
--           to each other before audio can flow. Both are the same shape — a
--           small ordered log per match, read by sequence — so they share one
--           table rather than inventing two.
--
-- CREATE TABLE only, no ALTER: SQLite has no ALTER TABLE IF NOT EXISTS, so an
-- ALTER-only migration cannot be re-run safely and the runner's "are its
-- objects already here?" probe has nothing to look at. Same reasoning as 0033.

-- Who has said they are ready, and when. One row per player per match; the
-- primary key makes a double-tap idempotent rather than a second vote.
CREATE TABLE IF NOT EXISTS cf_duel_ready (
  match_id   TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  ready_at   INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES cf_matches(id)
);

-- An ordered log of everything the two players say to each other.
--
-- `kind` is 'chat' for a line of text and 'rtc' for a signalling message —
-- an SDP offer or answer, or an ICE candidate — on its way to the other
-- browser. The server never reads the body of either. Signalling is just
-- delivery: the audio itself goes peer to peer and never touches this.
--
-- `to_player` NULL means "the room" (chat). A signalling message names its
-- recipient so a client never has to filter its own messages back out.
CREATE TABLE IF NOT EXISTS cf_duel_says (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id   TEXT NOT NULL,
  player_id  TEXT NOT NULL,           -- who said it
  to_player  TEXT,                    -- NULL = both
  kind       TEXT NOT NULL,           -- 'chat' | 'rtc'
  body       TEXT NOT NULL,
  at         INTEGER NOT NULL,
  FOREIGN KEY (match_id) REFERENCES cf_matches(id)
);

-- The only read there is: "everything in this match after id N", which is how
-- a poll picks up what it has not seen without re-reading the conversation.
CREATE INDEX IF NOT EXISTS idx_cf_duel_says_match ON cf_duel_says(match_id, id);
