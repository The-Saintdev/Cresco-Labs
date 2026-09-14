PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'suspended')),
  session_version INTEGER NOT NULL DEFAULT 1,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, email)
);

CREATE TABLE provider_credentials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL COLLATE NOCASE,
  encrypted_api_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, provider_key)
);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'video')),
  endpoint TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'beta', 'disabled')),
  price_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK (price_nano_usd >= 0),
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  owner_email TEXT NOT NULL COLLATE NOCASE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  user_email TEXT NOT NULL COLLATE NOCASE,
  model_id TEXT NOT NULL REFERENCES models(id),
  model_name TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'video')),
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('queued', 'complete', 'failed')),
  provider_request_id TEXT,
  provider_status_url TEXT,
  provider_response_url TEXT,
  provider_state TEXT,
  result_json TEXT,
  result_url TEXT,
  estimated_cost_nano_usd INTEGER NOT NULL DEFAULT 0,
  cost_nano_usd INTEGER NOT NULL DEFAULT 0,
  cost_source TEXT,
  error TEXT,
  last_provider_error TEXT,
  last_provider_attempt_at TEXT,
  poll_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  completed_at TEXT
);

CREATE TABLE generation_references (
  generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  PRIMARY KEY (generation_id, upload_id)
);

CREATE TABLE provider_balances (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL COLLATE NOCASE,
  amount_nano_usd INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('provider', 'ledger')),
  synced_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, provider)
);

CREATE TABLE budget_policies (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_monthly_limit_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK (workspace_monthly_limit_nano_usd >= 0),
  per_generation_limit_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK (per_generation_limit_nano_usd >= 0),
  warn_at_percent INTEGER NOT NULL DEFAULT 80 CHECK (warn_at_percent BETWEEN 1 AND 100),
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id),
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE login_rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

CREATE INDEX users_workspace_email_idx ON users (workspace_id, email);
CREATE INDEX models_workspace_created_idx ON models (workspace_id, created_at DESC);
CREATE INDEX generations_workspace_created_idx ON generations (workspace_id, created_at DESC);
CREATE INDEX generations_user_created_idx ON generations (user_id, created_at DESC);
CREATE INDEX generations_pending_idx ON generations (workspace_id, created_at) WHERE status = 'queued';
CREATE INDEX generations_model_created_idx ON generations (model_id, created_at DESC);
CREATE INDEX uploads_owner_created_idx ON uploads (owner_id, created_at DESC);
CREATE INDEX audit_workspace_created_idx ON audit_events (workspace_id, created_at DESC);

CREATE TRIGGER generations_budget_guard
BEFORE INSERT ON generations
BEGIN
  SELECT RAISE(ABORT, 'generation_limit_exceeded')
  WHERE (SELECT per_generation_limit_nano_usd FROM budget_policies WHERE workspace_id = NEW.workspace_id) > 0
    AND NEW.estimated_cost_nano_usd > (SELECT per_generation_limit_nano_usd FROM budget_policies WHERE workspace_id = NEW.workspace_id);

  SELECT RAISE(ABORT, 'workspace_budget_exceeded')
  WHERE (SELECT workspace_monthly_limit_nano_usd FROM budget_policies WHERE workspace_id = NEW.workspace_id) > 0
    AND COALESCE((
      SELECT SUM(CASE WHEN status = 'queued' THEN estimated_cost_nano_usd ELSE cost_nano_usd END)
      FROM generations
      WHERE workspace_id = NEW.workspace_id
        AND created_at >= strftime('%Y-%m-01T00:00:00.000Z', 'now')
    ), 0) + NEW.estimated_cost_nano_usd > (
      SELECT workspace_monthly_limit_nano_usd FROM budget_policies WHERE workspace_id = NEW.workspace_id
    );
END;

INSERT INTO workspaces (id, name, slug, created_at)
VALUES ('default', 'Cresco Labs', 'cresco-labs', CURRENT_TIMESTAMP);

INSERT INTO budget_policies (
  workspace_id,
  workspace_monthly_limit_nano_usd,
  per_generation_limit_nano_usd,
  warn_at_percent,
  updated_at
) VALUES ('default', 0, 0, 80, CURRENT_TIMESTAMP);
