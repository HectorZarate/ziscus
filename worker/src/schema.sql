CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  slug       TEXT NOT NULL,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  ip_hash    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  approved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_slug_status
  ON comments(slug, status, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT NOT NULL,
  window  TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mod_log (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'admin',
  comment_id TEXT,
  slug       TEXT,
  reason     TEXT NOT NULL DEFAULT '',
  metadata   TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_mod_log_created
  ON mod_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mod_log_action
  ON mod_log(action, created_at DESC);

CREATE TABLE IF NOT EXISTS banned_ips (
  ip_hash   TEXT PRIMARY KEY,
  reason    TEXT NOT NULL DEFAULT '',
  banned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
