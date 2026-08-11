-- Leaving, and going again.
--
-- Two ends of a match that had no ending. A player who closed the tab left
-- the other one playing out every remaining kick against a deadline, one
-- twenty-five-second silence at a time, with nothing on screen to say why —
-- and a match that did finish had no way back other than the main menu and
-- the queue.
--
-- CREATE TABLE only, no ALTER, for the reason 0033 gives: SQLite has no
-- ALTER TABLE IF NOT EXISTS, so an ALTER-only migration cannot be re-run and
-- the runner's "are its objects already here?" probe has nothing to look at.

-- Who has walked away. One row per player per match; the primary key makes a
-- retried "I am leaving" idempotent, which matters because it is sent from a
-- page that is in the middle of closing.
CREATE TABLE IF NOT EXISTS cf_duel_gone (
  match_id   TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES cf_matches(id)
);

-- Who wants to go again, and what they were given when both did.
--
-- `next_match` is written by whichever request found the second row, and the
-- other player picks it up on their next sync. Storing it rather than
-- returning it twice is what stops two simultaneous acceptances creating two
-- rematches: the second writer loses the guarded UPDATE and reads the first
-- one's answer.
CREATE TABLE IF NOT EXISTS cf_duel_again (
  match_id   TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  at         INTEGER NOT NULL,
  next_match TEXT,
  PRIMARY KEY (match_id, player_id),
  FOREIGN KEY (match_id) REFERENCES cf_matches(id)
);
