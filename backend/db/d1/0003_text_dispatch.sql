ALTER TABLE models ADD COLUMN thinking_mode TEXT NOT NULL DEFAULT 'disabled';
ALTER TABLE models ADD COLUMN text_api TEXT NOT NULL DEFAULT 'chat_completions';

ALTER TABLE generations ADD COLUMN provider_latency_ms INTEGER;
