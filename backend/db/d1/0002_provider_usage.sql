CREATE TABLE provider_usage_snapshots (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL COLLATE NOCASE,
  period_start TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  cost_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK (cost_nano_usd >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  synced_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, provider, period_start, endpoint_id)
);

CREATE INDEX provider_usage_workspace_period_idx
  ON provider_usage_snapshots (workspace_id, period_start DESC);
