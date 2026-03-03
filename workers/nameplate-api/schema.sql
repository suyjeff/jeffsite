CREATE TABLE IF NOT EXISTS nameplates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  theme TEXT NOT NULL CHECK(theme IN ('portfolio','mauve','brat','nyt')),
  font TEXT NOT NULL CHECK(font IN ('default','serif','mono')),
  effect TEXT NOT NULL CHECK(effect IN ('solid','gradient','neon','toon','pop')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  visitor_token TEXT NOT NULL UNIQUE,
  x REAL,
  y REAL,
  rotation REAL
);

CREATE INDEX IF NOT EXISTS idx_nameplates_created ON nameplates(created_at DESC);
