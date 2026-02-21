# Centris Memory Architecture — Per-User Server Storage

This document describes the target memory architecture: **per-user memory stored in a server/database (Supabase), not on the user's local computer**.

## Current State (Implemented)

| Memory Type                 | Storage                                                                           | User-Scoped?        | Persistence                                           |
| --------------------------- | --------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| **web.memory** (Action API) | In-memory (default) or Supabase when `CENTRIS_MEMORY_STORAGE=supabase` + `userId` | Yes (when Supabase) | Server when Supabase                                  |
| **Agent memory** (OpenClaw) | `<workspace>/MEMORY.md`, `memory/*.md`, `.memory/index.sqlite`                    | No (workspace)      | Local disk                                            |
| **Learned routes**          | `~/.centris/connectors/<app>/centris.json`                                        | No                  | Local disk                                            |
| **Old patterns/learnings**  | Cloudflare KV + Supabase RPC                                                      | Yes                 | Deprecated (gate with `CENTRIS_DEPRECATE_OLD_SYNC=1`) |

## Target State

| Memory Type                | Target Storage                     | User-Scoped?    | Persistence |
| -------------------------- | ---------------------------------- | --------------- | ----------- |
| **web.memory**             | Supabase (table or storage bucket) | Yes (`user_id`) | Server      |
| **Agent memory**           | Supabase (table or storage bucket) | Yes (`user_id`) | Server      |
| **Learned routes**         | Supabase or server                 | Yes (`user_id`) | Server      |
| **Old patterns/learnings** | Remove/deprecate                   | —               | —           |

## Required Updates

### 1. Deprecate Old Supabase Sync (Cloudflare Workers)

**Files:** `cloudflare-workers/centris-gateway/src/supabase-sync.js`

- Mark `user_patterns`, `user_learnings`, `get_user_patterns_for_sync`, `get_user_learnings_for_sync` as deprecated.
- Plan migration path: either migrate data to new schema or sunset with user notification.
- Remove or gate sync endpoints: `/api/sync/pull`, `/api/sync/push`, `/api/sync/full`, `/api/learning/add`.

### 2. Add Per-User Memory Storage (Supabase)

**Option A: Supabase Storage Bucket** (like Norma `norma-memory`)

- Bucket: `centris-memory` (private)
- Paths: `users/{user_id}/web-memory/{cache_key}.json`
- Each file = one `WebMemoryEntry` (url, intent, actionIndex, routeMemory, etc.)
- Pros: Simple, JSON per entry, easy to invalidate by path
- Cons: Many small files, no SQL queries

**Option B: Supabase Tables**

- Table: `centris_web_memory` (user_id, cache_key, url, intent, payload JSONB, created_at, expires_at)
- RLS: `user_id = auth.uid()` or service role for gateway
- Pros: Queryable, indexes, TTL via cron
- Cons: Schema migrations, row limits

**Recommended:** Start with **Option B (tables)** for web.memory — easier to query, invalidate by user, and enforce TTL. Use **Storage bucket** only if payloads are large or binary.

### 3. Update web.memory Action API

**File:** `src/gateway/action-api-authority.ts`

- Add optional `userId` to Action API session/params. When present and Supabase is configured, use server store. When absent (e.g. CLI/SDK dev use), use in-memory store.
- Replace in-memory `Map` with Supabase-backed store:
  - `web.memory.index` → INSERT/upsert into `centris_web_memory`
  - `web.memory.resolve` → SELECT by user_id + url + intent
  - `web.memory.execute` → read from DB, run route
  - `web.memory.invalidate` → DELETE by user_id + scope
  - `web.memory.stats` → COUNT by user_id
- Cache key: when `userId` present → `user:{userId}:wm:{hash}`; when absent → `wm:{hash}` (current behavior, in-memory only)

### 4. Who Provides userId (Not SDK/CLI)

- **CLI and SDK:** No user auth. These are for developers running commands and scripts themselves. They do **not** need to pass `userId`.
- **Authenticated clients:** The packaged desktop app, voice interface, or web app — when the end-user is logged in — provides `userId` via `session.metadata.userId` (or equivalent) when calling the gateway.
- **Local gateway (dev):** When `userId` is absent, use in-memory store. Developers using CLI/SDK against local gateway get in-memory behavior.
- **Production gateway:** When Supabase is configured and the request includes `userId` (from the app’s auth layer), persist to server. No changes required in SDK/CLI.

### 5. Supabase Schema (Draft)

```sql
-- centris_web_memory: per-user web memory entries
CREATE TABLE centris_web_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  intent TEXT,
  payload JSONB NOT NULL,  -- actionIndex, routeMemory, pageFingerprint, etc.
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolve_hits INT NOT NULL DEFAULT 0,
  UNIQUE(user_id, cache_key)
);

CREATE INDEX idx_centris_web_memory_user_url ON centris_web_memory(user_id, normalized_url);
CREATE INDEX idx_centris_web_memory_expires ON centris_web_memory(expires_at);

-- RLS: users can only access their own rows
ALTER TABLE centris_web_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own web memory"
  ON centris_web_memory FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### 6. Gateway Configuration

- Add env: `CENTRIS_MEMORY_STORAGE=supabase` | `local` (default `local` for backward compat)
- When `supabase`: use Supabase client; require `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- When `local`: keep current in-memory behavior (dev/single-user)

## Migration Path

1. Add Supabase migration for `centris_web_memory` table.
2. Implement `WebMemoryStore` interface with `SupabaseWebMemoryStore` and `InMemoryWebMemoryStore`.
3. Wire `action-api-authority` to use store based on config.
4. Add `userId` to Action API session contract; authenticated clients (desktop app, extension) pass it. SDK/CLI unchanged — no auth required for dev use.
5. Deprecate old sync module; add deprecation notices to Cloudflare Workers.
6. Document migration for existing users (if any data in old system).

## References

- Norma memory pattern: `normaai/src/services/memory-storage.ts` (Supabase Storage bucket)
- Current web.memory: `src/gateway/action-api-authority.ts` (in-memory Map)
- Old sync: `cloudflare-workers/centris-gateway/src/supabase-sync.js` (deprecated)
