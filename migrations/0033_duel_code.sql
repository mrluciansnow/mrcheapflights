-- (Renumbered from 0008 on the trunk merge — see 0031.)
-- A short code you can read down a phone.
--
-- Match ids are 20 hex characters, which is right for a URL and useless for a
-- person: "give them this code" is only a real instruction if the code fits in
-- a sentence. So a duel gets a five-character one from an alphabet with no
-- confusable glyphs in it — no O or 0, no I or 1 — and the id stays what the
-- API uses.
--
-- A separate table rather than a column on cf_duels, deliberately: ALTER TABLE
-- has no IF NOT EXISTS in SQLite, so an ALTER-only migration cannot be safely
-- re-run, and the migration runner's "are its objects already here?" probe has
-- nothing to look at. A CREATE TABLE has both properties for free.

CREATE TABLE IF NOT EXISTS cf_duel_codes (
  code       TEXT PRIMARY KEY,          -- five chars, upper case
  match_id   TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (match_id) REFERENCES cf_matches(id)
);
CREATE INDEX IF NOT EXISTS idx_cf_duel_codes_match ON cf_duel_codes(match_id);
