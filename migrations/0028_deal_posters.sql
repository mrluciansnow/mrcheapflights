-- Ordered poster slides for a deal — the Instagram carousel.
--
-- deals.poster_url holds the single-image poster and stays the default. A
-- carousel is a SET: slide 0 is the deal itself, then one slide per departure
-- city showing that city's own price, so every follower sees their own airport
-- in the same post.
CREATE TABLE IF NOT EXISTS deal_posters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id     INTEGER NOT NULL,
  slide_index INTEGER NOT NULL,          -- 0-based render order
  url         TEXT    NOT NULL,          -- /images/posters/...
  city        TEXT,                       -- departure city (NULL on the lead slide)
  price       TEXT,                       -- that city's price, as displayed
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(deal_id, slide_index)
);
CREATE INDEX IF NOT EXISTS idx_deal_posters_deal ON deal_posters(deal_id, slide_index);
