CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'capturing',
  title TEXT,
  summary TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '{}',
  resolved TEXT NOT NULL DEFAULT '{}',
  media TEXT NOT NULL DEFAULT '[]',
  candidates TEXT NOT NULL DEFAULT '[]',
  public INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_created ON items(created_at DESC);
CREATE INDEX IF NOT EXISTS items_kind ON items(kind);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  type TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
