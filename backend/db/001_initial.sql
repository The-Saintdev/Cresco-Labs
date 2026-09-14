CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  email citext NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  status text NOT NULL CHECK (status IN ('active', 'pending', 'suspended')),
  session_version integer NOT NULL DEFAULT 1,
  preferences jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE TABLE provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider citext NOT NULL,
  encrypted_api_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  provider text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'image', 'video')),
  endpoint text,
  status text NOT NULL CHECK (status IN ('active', 'beta', 'disabled')),
  price_nano_usd bigint NOT NULL DEFAULT 0 CHECK (price_nano_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id),
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  storage_key text NOT NULL UNIQUE,
  public_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  user_email citext NOT NULL,
  model_id uuid NOT NULL REFERENCES models(id),
  model_name text NOT NULL,
  model_provider text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'image', 'video')),
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('queued', 'complete', 'failed')),
  provider_request_id text,
  provider_state text,
  result_url text,
  cost_nano_usd bigint NOT NULL DEFAULT 0,
  cost_source text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE generation_references (
  generation_id uuid NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES uploads(id),
  PRIMARY KEY (generation_id, upload_id)
);

CREATE TABLE balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  amount_nano_usd bigint NOT NULL,
  source text NOT NULL CHECK (source IN ('provider', 'ledger')),
  synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE budget_policies (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_monthly_limit_nano_usd bigint NOT NULL DEFAULT 0 CHECK (workspace_monthly_limit_nano_usd >= 0),
  per_generation_limit_nano_usd bigint NOT NULL DEFAULT 0 CHECK (per_generation_limit_nano_usd >= 0),
  warn_at_percent smallint NOT NULL DEFAULT 80 CHECK (warn_at_percent BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  actor_email citext NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX generations_workspace_created_idx ON generations (workspace_id, created_at DESC);
CREATE INDEX generations_user_created_idx ON generations (user_id, created_at DESC);
CREATE INDEX generations_pending_idx ON generations (workspace_id, created_at) WHERE status = 'queued';
CREATE INDEX generations_model_created_idx ON generations (model_id, created_at DESC);
CREATE INDEX uploads_owner_created_idx ON uploads (owner_id, created_at DESC);
CREATE INDEX audit_workspace_created_idx ON audit_events (workspace_id, created_at DESC);
CREATE INDEX balances_workspace_provider_idx ON balance_snapshots (workspace_id, provider, synced_at DESC);
