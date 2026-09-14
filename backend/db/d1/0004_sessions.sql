CREATE TABLE generation_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  model_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX generation_sessions_owner_idx
  ON generation_sessions (workspace_id, user_id, updated_at DESC);

ALTER TABLE generations ADD COLUMN session_id TEXT;

CREATE INDEX generations_session_idx
  ON generations (session_id, created_at);
