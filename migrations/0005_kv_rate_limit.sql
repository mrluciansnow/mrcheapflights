-- Rate-limit counter table used by /api/ai proxy.
-- Key format: ai_rl:<ip>:<minute_epoch> — rows expire naturally; prune old rows periodically.
CREATE TABLE IF NOT EXISTS kv_rate_limit (
  key   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
