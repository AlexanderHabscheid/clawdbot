-- ============================================
-- Migration 001: Centris Web Memory
--
-- Per-user web memory for Action API (web.memory.*).
-- Replaces in-memory storage when CENTRIS_MEMORY_STORAGE=supabase.
--
-- Paths: docs/MEMORY_ARCHITECTURE.md
-- ============================================

CREATE TABLE IF NOT EXISTS centris_web_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  cache_key TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  intent TEXT,
  payload JSONB NOT NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolve_hits INT NOT NULL DEFAULT 0,
  UNIQUE(user_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_centris_web_memory_user_url
  ON centris_web_memory(user_id, normalized_url);
CREATE INDEX IF NOT EXISTS idx_centris_web_memory_expires
  ON centris_web_memory(expires_at);

-- RLS: optional — enable if using auth.users. Gateway uses service key.
-- ALTER TABLE centris_web_memory ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can manage own web memory"
--   ON centris_web_memory FOR ALL
--   USING (auth.uid() = user_id)
--   WITH CHECK (auth.uid() = user_id);
