/**
 * Supabase Sync Module for Cloudflare Workers
 * ============================================
 *
 * @deprecated This module is part of the OLD user learnings/patterns system.
 * The target architecture is per-user memory in a server/database storage
 * (Supabase table or bucket), not KV + legacy RPC. See docs/MEMORY_ARCHITECTURE.md.
 *
 * OPTIMIZED FOR 100K+ USERS - Minimal KV writes
 *
 * This module handles bi-directional sync between Cloudflare KV (edge cache)
 * and Supabase (persistent storage). The architecture ensures:
 *
 * - HOT PATH (every request): Uses KV for ~3ms latency
 * - COLD PATH (on login, periodic): Syncs with Supabase (50-80ms)
 *
 * KV OPTIMIZATION:
 * ================
 * - SINGLE KEY per user: user:{user_id}:data (patterns + learnings + meta)
 * - Batched syncs: Only sync after N executions or every 5 minutes
 * - This reduces KV writes by 66% compared to separate keys
 *
 * KV WRITE BUDGET (100K users):
 * - Old: 3 keys × 10 syncs/day × 100K = 3M writes/day ❌
 * - New: 1 key × 3 syncs/day × 100K = 300K writes/day ✅
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SUPABASE CLIENT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create Supabase REST API headers
 */
function getSupabaseHeaders(env, useServiceKey = false) {
  const apiKey = useServiceKey ? env.SUPABASE_SERVICE_KEY : env.SUPABASE_ANON_KEY;

  return {
    "Content-Type": "application/json",
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    Prefer: "return=representation",
  };
}

/**
 * Make a Supabase REST API request
 */
async function supabaseRequest(env, path, options = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1${path}`;

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      ...getSupabaseHeaders(env, options.useServiceKey),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Call a Supabase RPC function
 */
async function supabaseRpc(env, functionName, params = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/${functionName}`;

  const response = await fetch(url, {
    method: "POST",
    headers: getSupabaseHeaders(env, true),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase RPC error (${response.status}): ${error}`);
  }

  return response.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// KV HELPERS - SINGLE KEY PER USER (optimized for scale)
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC THRESHOLDS - OPTIMIZED FOR ~2 KV WRITES PER USER PER DAY
// ═══════════════════════════════════════════════════════════════════════════════
// Free tier: 100K writes/day
// Target: 50K users = 2 writes each = 100K writes
//
// User flow:
//   1. Login → syncFromSupabase() → 1 KV write
//   2. Execute tasks → accumulate learnings in Supabase (no KV write until batch)
//   3. Logout/end of day → fullSync() → 1 KV write (if anything pending)
//
// Total: ~2 writes per active user per day
// ═══════════════════════════════════════════════════════════════════════════════
const SYNC_BATCH_SIZE = 10; // Sync after N learnings accumulated (doubled from 5)
const SYNC_INTERVAL_MS = 3600000; // Or sync every 60 minutes (doubled from 30)

/**
 * Get all user data from single KV key
 * Returns: { patterns, learnings, sync_meta, pending_learnings }
 */
async function getUserData(env, userId) {
  const key = `user:${userId}:data`;
  const data = await env.CACHE.get(key, "json");
  return (
    data || {
      patterns: [],
      learnings: [],
      sync_meta: {
        last_supabase_sync: null,
        last_kv_update: null,
        version: 0,
        pending_count: 0,
      },
      pending_learnings: [], // Not yet synced to Supabase
    }
  );
}

/**
 * Save all user data to single KV key (1 write)
 */
async function setUserData(env, userId, data) {
  const key = `user:${userId}:data`;
  const payload = {
    patterns: data.patterns || [],
    learnings: (data.learnings || []).slice(0, 100), // Cap at 100
    sync_meta: {
      ...data.sync_meta,
      last_kv_update: new Date().toISOString(),
      version: (data.sync_meta?.version || 0) + 1,
    },
    pending_learnings: data.pending_learnings || [],
  };

  await env.CACHE.put(key, JSON.stringify(payload), {
    expirationTtl: 86400, // 24h TTL
  });

  return payload;
}

/**
 * Check if we should sync to Supabase based on batch size or time
 */
function shouldSyncToSupabase(syncMeta, pendingCount) {
  // Sync if we have enough pending learnings
  if (pendingCount >= SYNC_BATCH_SIZE) {
    return true;
  }

  // Sync if it's been too long since last sync
  if (syncMeta.last_supabase_sync) {
    const lastSync = new Date(syncMeta.last_supabase_sync).getTime();
    if (Date.now() - lastSync > SYNC_INTERVAL_MS) {
      return true;
    }
  }

  return false;
}

// Compatibility wrappers for existing code
async function getUserPatternsFromKV(env, userId) {
  const data = await getUserData(env, userId);
  return {
    patterns: data.patterns,
    synced_at: data.sync_meta.last_kv_update,
    version: data.sync_meta.version,
  };
}

async function getUserLearningsFromKV(env, userId) {
  const data = await getUserData(env, userId);
  return {
    learnings: data.learnings,
    synced_at: data.sync_meta.last_kv_update,
    version: data.sync_meta.version,
  };
}

async function getSyncMeta(env, userId) {
  const data = await getUserData(env, userId);
  return data.sync_meta;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sync user data from Supabase to KV (pull to edge)
 * Call this on user login or app startup
 *
 * OPTIMIZED: Single KV write for all data
 *
 * @param {Object} env - Cloudflare worker environment
 * @param {string} userId - User's UUID
 * @returns {Object} Sync result with counts
 */
export async function syncFromSupabase(env, userId) {
  const startTime = Date.now();
  const result = {
    success: true,
    patterns_synced: 0,
    learnings_synced: 0,
    kv_writes: 0,
    duration_ms: 0,
    errors: [],
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    result.success = false;
    result.errors.push("Supabase not configured");
    return result;
  }

  try {
    // Fetch patterns and learnings from Supabase (parallel requests)
    const [patterns, learnings] = await Promise.all([
      supabaseRpc(env, "get_user_patterns_for_sync", { p_user_id: userId }),
      supabaseRpc(env, "get_user_learnings_for_sync", { p_user_id: userId, p_limit: 100 }),
    ]);

    // Transform to KV format
    const kvPatterns = (patterns || []).map((p) => ({
      key: p.pattern_key,
      type: p.pattern_type,
      domain: p.domain,
      data: p.pattern_data,
      confidence: p.confidence,
      use_count: p.use_count,
    }));

    const kvLearnings = (learnings || []).map((l) => ({
      type: l.learning_type,
      domain: l.domain,
      content: l.learning_content,
      data: l.learning_data,
      importance: l.importance,
      created_at: l.created_at,
    }));

    // SINGLE KV WRITE for all user data
    await setUserData(env, userId, {
      patterns: kvPatterns,
      learnings: kvLearnings,
      sync_meta: {
        last_supabase_sync: new Date().toISOString(),
        pending_count: 0,
      },
      pending_learnings: [],
    });

    result.patterns_synced = kvPatterns.length;
    result.learnings_synced = kvLearnings.length;
    result.kv_writes = 1;
  } catch (error) {
    result.success = false;
    result.errors.push(error.message);
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

/**
 * Sync user data from KV to Supabase (push to persist)
 * Call this after task execution (in background, don't block user)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * KV WRITE OPTIMIZATION: ~0 writes per execution!
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * KEY INSIGHT: Supabase writes are FREE (no daily limit), KV writes cost us.
 *
 * Strategy:
 * 1. Learnings → Write DIRECTLY to Supabase (free, no batching needed)
 * 2. Execution logs → Write DIRECTLY to Supabase (free)
 * 3. Patterns → Write to Supabase, only update KV on login sync
 * 4. KV → Only updated on login (syncFromSupabase) and logout (fullSync)
 *
 * This reduces KV writes from 2-3 per execution to 0 per execution!
 * Users get ~2 KV writes per day total (login + logout).
 *
 * @param {Object} env - Cloudflare worker environment
 * @param {string} userId - User's UUID
 * @param {Object} data - Data to sync (patterns, learnings, execution)
 * @returns {Object} Sync result
 */
export async function syncToSupabase(env, userId, data) {
  const startTime = Date.now();
  const result = {
    success: true,
    patterns_synced: 0,
    learnings_synced: 0,
    execution_logged: false,
    kv_writes: 0,
    batched: false,
    supabase_writes: 0,
    duration_ms: 0,
    errors: [],
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    result.success = false;
    result.errors.push("Supabase not configured");
    return result;
  }

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // PATTERNS → Supabase immediately (rare, important)
    // NO KV WRITE - patterns will be synced to KV on next login
    // ═══════════════════════════════════════════════════════════════════════════
    if (data.patterns && data.patterns.length > 0) {
      for (const pattern of data.patterns) {
        try {
          await supabaseRpc(env, "upsert_user_pattern", {
            p_user_id: userId,
            p_pattern_key: pattern.key,
            p_pattern_type: pattern.type,
            p_domain: pattern.domain || null,
            p_pattern_data: pattern.data,
            p_confidence: pattern.confidence || 1.0,
            p_use_count: pattern.use_count || 1,
          });
          result.patterns_synced++;
          result.supabase_writes++;
        } catch (e) {
          result.errors.push(`Pattern sync error: ${e.message}`);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXECUTION LOG → Supabase immediately (audit trail, always write)
    // NO KV WRITE - execution logs live in Supabase only
    // ═══════════════════════════════════════════════════════════════════════════
    if (data.execution) {
      const exec = data.execution;
      const executionLog = {
        user_id: userId,
        session_id: exec.session_id || "unknown",
        task_id: exec.task_id || null,
        instruction: exec.instruction,
        generalized_instruction: exec.generalized_instruction || null,
        matched_pattern_id: exec.matched_pattern_id || null,
        pattern_confidence: exec.pattern_confidence || null,
        context: exec.context || null,
        domain: exec.domain || null,
        execution_strategy: exec.strategy || "planned",
        plan: exec.plan || null,
        actions_executed: exec.actions || null,
        action_count: exec.action_count || 0,
        success: exec.success,
        result: exec.result || null,
        error_message: exec.error || null,
        learnings: exec.learnings || null,
        started_at: exec.started_at || new Date().toISOString(),
        completed_at: exec.completed_at || new Date().toISOString(),
        duration_ms: exec.duration_ms || null,
        planning_ms: exec.planning_ms || null,
        execution_ms: exec.execution_ms || null,
        client_type: exec.client_type || "desktop",
        client_version: exec.client_version || null,
        model_used: exec.model_used || null,
        tokens_used: exec.tokens_used || null,
      };

      await supabaseRequest(env, "/execution_logs", {
        method: "POST",
        body: executionLog,
        useServiceKey: true,
      });

      result.execution_logged = true;
      result.supabase_writes++;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LEARNINGS → Supabase IMMEDIATELY (no batching in KV!)
    // This is the key optimization: write directly to Supabase, skip KV entirely
    // Supabase has no daily write limit, so we write every learning immediately
    // KV will be updated on next login when syncFromSupabase runs
    // ═══════════════════════════════════════════════════════════════════════════
    const newLearnings = data.learnings || [];
    if (newLearnings.length > 0) {
      const learningsToInsert = newLearnings.map((l) => ({
        user_id: userId,
        session_id: data.session_id || null,
        learning_type: l.type,
        domain: l.domain || null,
        task_description: l.task || null,
        learning_content: l.content,
        learning_data: l.data || null,
        importance: l.importance || "medium",
      }));

      await supabaseRequest(env, "/user_learnings", {
        method: "POST",
        body: learningsToInsert,
        useServiceKey: true,
      });

      result.learnings_synced = learningsToInsert.length;
      result.supabase_writes++;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // KV WRITE: ZERO!
    // All data goes directly to Supabase. KV is only updated on:
    //   1. Login → syncFromSupabase() pulls latest from Supabase
    //   2. Logout → fullSync() ensures nothing is lost
    // ═══════════════════════════════════════════════════════════════════════════
    result.kv_writes = 0;
    result.batched = false; // No batching needed - direct to Supabase
  } catch (error) {
    result.success = false;
    result.errors.push(error.message);
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

/**
 * Full bi-directional sync (merge both directions)
 * Call this periodically (every 1 hour) or on explicit request
 *
 * OPTIMIZED: Single KV read/write
 */
export async function fullSync(env, userId) {
  const result = {
    from_supabase: null,
    pending_flushed: 0,
    kv_writes: 0,
    success: true,
  };

  // Get current data to check for pending learnings
  const userData = await getUserData(env, userId);
  const pendingLearnings = userData.pending_learnings || [];

  // Flush any pending learnings to Supabase first
  if (pendingLearnings.length > 0) {
    const learningsToInsert = pendingLearnings.map((l) => ({
      user_id: userId,
      session_id: null,
      learning_type: l.type,
      domain: l.domain || null,
      task_description: l.task || null,
      learning_content: l.content,
      learning_data: l.data || null,
      importance: l.importance || "medium",
    }));

    try {
      await supabaseRequest(env, "/user_learnings", {
        method: "POST",
        body: learningsToInsert,
        useServiceKey: true,
      });
      result.pending_flushed = learningsToInsert.length;
    } catch (e) {
      result.success = false;
    }
  }

  // Pull fresh from Supabase (includes just-flushed learnings)
  result.from_supabase = await syncFromSupabase(env, userId);
  result.kv_writes = result.from_supabase.kv_writes || 1;

  result.success = result.success && result.from_supabase.success;

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle POST /api/sync/pull
 * Pull user data from Supabase to KV (call on login)
 */
export async function handleSyncPull(request, env) {
  try {
    const body = await request.json();
    const { user_id } = body;

    if (!user_id) {
      return jsonResponse({ error: "Missing user_id" }, 400);
    }

    const result = await syncFromSupabase(env, user_id);

    return jsonResponse({
      success: result.success,
      message: result.success
        ? `Synced ${result.patterns_synced} patterns, ${result.learnings_synced} learnings from Supabase`
        : "Sync failed",
      ...result,
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * Handle POST /api/sync/push
 * Push data from KV/backend to Supabase (call after execution)
 */
export async function handleSyncPush(request, env) {
  try {
    const body = await request.json();
    const { user_id, patterns, learnings, execution } = body;

    if (!user_id) {
      return jsonResponse({ error: "Missing user_id" }, 400);
    }

    const result = await syncToSupabase(env, user_id, {
      patterns,
      learnings,
      execution,
    });

    return jsonResponse({
      success: result.success,
      message: result.success
        ? `Synced ${result.patterns_synced} patterns, ${result.learnings_synced} learnings, logged: ${result.execution_logged}`
        : "Sync failed",
      ...result,
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * Handle POST /api/sync/full
 * Full bi-directional sync
 */
export async function handleSyncFull(request, env) {
  try {
    const body = await request.json();
    const { user_id } = body;

    if (!user_id) {
      return jsonResponse({ error: "Missing user_id" }, 400);
    }

    const result = await fullSync(env, user_id);

    return jsonResponse({
      success: result.success,
      ...result,
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * Handle GET /api/sync/status
 * Get sync status for a user (SINGLE KV read)
 */
export async function handleSyncStatus(request, env) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id");

    if (!userId) {
      return jsonResponse({ error: "Missing user_id parameter" }, 400);
    }

    // Single KV read for all user data
    const userData = await getUserData(env, userId);

    return jsonResponse({
      success: true,
      user_id: userId,
      sync_meta: userData.sync_meta,
      kv_status: {
        patterns_count: userData.patterns.length,
        learnings_count: userData.learnings.length,
        pending_learnings: userData.pending_learnings?.length || 0,
        last_sync: userData.sync_meta.last_supabase_sync,
        version: userData.sync_meta.version,
      },
      optimization: {
        // New optimization: Direct-to-Supabase strategy
        strategy: "direct_to_supabase",
        description:
          "Learnings/executions write directly to Supabase (free). KV only updated on login/logout.",
        expected_kv_writes_per_user_per_day: 2,
        kv_write_triggers: ["syncFromSupabase (login)", "fullSync (logout/periodic)"],
        batch_size: SYNC_BATCH_SIZE,
        sync_interval_ms: SYNC_INTERVAL_MS,
      },
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * Handle POST /api/learning/add
 * Add a single learning - writes DIRECTLY to Supabase (no KV batching!)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * KV WRITE OPTIMIZATION: 0 writes!
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Old approach: Batch learnings in KV, flush when threshold met (1 KV write per flush)
 * New approach: Write directly to Supabase (0 KV writes ever!)
 *
 * Why this is better:
 * - Supabase has NO daily write limit (vs KV free tier 100K/day)
 * - Learnings are persisted immediately (no risk of losing batched data)
 * - KV stays clean for read-heavy operations (patterns lookup on every request)
 * - User gets latest learnings on next login via syncFromSupabase
 */
export async function handleAddLearning(request, env) {
  try {
    const body = await request.json();
    const { user_id, learning, session_id } = body;

    if (!user_id || !learning) {
      return jsonResponse({ error: "Missing user_id or learning" }, 400);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WRITE DIRECTLY TO SUPABASE (no KV involvement!)
    // ═══════════════════════════════════════════════════════════════════════════
    const learningRow = {
      user_id: user_id,
      session_id: session_id || null,
      learning_type: learning.type,
      domain: learning.domain || null,
      task_description: learning.task || null,
      learning_content: learning.content,
      learning_data: learning.data || null,
      importance: learning.importance || "medium",
    };

    await supabaseRequest(env, "/user_learnings", {
      method: "POST",
      body: learningRow,
      useServiceKey: true,
    });

    return jsonResponse({
      success: true,
      message: "Learning saved to Supabase (will sync to edge on next login)",
      kv_writes: 0,
      supabase_writes: 1,
      synced_to_edge: false, // Will sync on next login
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// Helper function
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Export all for use in index.js
export {
  getUserData,
  setUserData,
  getUserPatternsFromKV, // Compatibility wrapper
  getUserLearningsFromKV, // Compatibility wrapper
  getSyncMeta, // Compatibility wrapper
  shouldSyncToSupabase,
  SYNC_BATCH_SIZE,
  SYNC_INTERVAL_MS,
};
