/**
 * Centris AI Gateway Worker
 * =========================
 * The SELF-LEARNING core of Centris AI. This worker handles:
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                    💾 KV WRITE OPTIMIZATION STRATEGY                      ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                           ║
 * ║  TARGET: ~2 KV writes per user per day (down from 10-20)                  ║
 * ║  FREE TIER: 100K KV writes/day → supports 50K daily active users          ║
 * ║                                                                           ║
 * ║  STRATEGY: Direct-to-Supabase                                             ║
 * ║  - Supabase has NO daily write limit (free tier unlimited)                ║
 * ║  - KV used only for READ-heavy operations (pattern lookup)                ║
 * ║                                                                           ║
 * ║  KV WRITES (per user/day):                                                ║
 * ║  ┌─────────────────────┬────────────────────────────────────────────────┐ ║
 * ║  │ syncFromSupabase    │ 1 write on login (pulls patterns to edge)      │ ║
 * ║  │ fullSync            │ 1 write on logout (ensures nothing lost)       │ ║
 * ║  │ syncToSupabase      │ 0 writes! Goes directly to Supabase            │ ║
 * ║  │ handleAddLearning   │ 0 writes! Goes directly to Supabase            │ ║
 * ║  │ handleContextSync   │ 0-1 write (only preferences, rarely changes)   │ ║
 * ║  │ incrementCacheStats │ ~0.01 writes (batched per 100 requests)        │ ║
 * ║  │ handleSessionContext│ ~0.5 writes (skips unchanged sessions)         │ ║
 * ║  └─────────────────────┴────────────────────────────────────────────────┘ ║
 * ║                                                                           ║
 * ║  TOTAL: ~2-3 writes/user/day                                              ║
 * ║                                                                           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                    🧠 SELF-LEARNING EXECUTION FLOW                        ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                            ║
 * ║  User speaks: "go to gmail"                                                ║
 * ║       │                                                                    ║
 * ║       ▼                                                                    ║
 * ║  ┌─────────────────────────────────────────────────────────────────────┐  ║
 * ║  │ 1. VECTORIZE SEARCH (POST /api/patterns/instant)                    │  ║
 * ║  │    - Search for patterns learned from past executions               │  ║
 * ║  │    - If found with high confidence → INSTANT! (no LLM needed)       │  ║
 * ║  └─────────────────────────────────────────────────────────────────────┘  ║
 * ║       │                                                                    ║
 * ║       ▼ Not found?                                                         ║
 * ║  ┌─────────────────────────────────────────────────────────────────────┐  ║
 * ║  │ 2. LLM PLANNING (via AI Gateway)                                    │  ║
 * ║  │    - Template cached (POST /api/template/init once at startup)      │  ║
 * ║  │    - Only user message sent each time (99% token reduction!)        │  ║
 * ║  │    - DeepSeek plans the execution                                   │  ║
 * ║  └─────────────────────────────────────────────────────────────────────┘  ║
 * ║       │                                                                    ║
 * ║       ▼ After successful execution                                         ║
 * ║  ┌─────────────────────────────────────────────────────────────────────┐  ║
 * ║  │ 3. INDEX TO VECTORIZE (POST /api/patterns/index) 🎓                  │  ║
 * ║  │    - Store: pattern + tool_calls + success/failure                  │  ║
 * ║  │    - Next time similar command = INSTANT!                           │  ║
 * ║  └─────────────────────────────────────────────────────────────────────┘  ║
 * ║                                                                            ║
 * ║  KEY: Every successful execution makes future similar commands instant.   ║
 * ║       The more you use it, the faster it gets.                            ║
 * ║                                                                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Key Endpoints:
 * - POST /api/patterns/instant  → Check Vectorize for learned pattern (called DURING speech)
 * - POST /api/patterns/index    → Index successful execution (called AFTER execution)
 * - POST /api/patterns/search   → Semantic search for similar patterns
 * - POST /api/chat/template     → LLM call with cached template (99% fewer tokens!)
 *
 * Bindings Required:
 * - PATTERNS: Vectorize index (centris-patterns, 768-dim, cosine)
 * - CACHE: KV namespace for pattern data and templates
 * - AI: Workers AI for embeddings
 * - AI_GATEWAY_URL: Cloudflare AI Gateway URL for LLM routing
 *
 * @see https://developers.cloudflare.com/vectorize/
 * @see https://developers.cloudflare.com/ai-gateway/
 */

import { matchCommand, COMMAND_CACHE } from "./command-cache.js";
import {
  detectContext,
  searchContexts,
  populateContexts,
  handleContextDetect,
  handleContextPopulate,
  handleContextList,
  handleContextCapabilities,
  CONTEXT_SIGNATURES,
} from "./context-vectorize.js";
import {
  DOMAIN_PACKAGES,
  getDomainContext,
  formatContextForLLM,
  normalizeDomain,
  getWaitTime,
  getDomainStats,
} from "./domain-packages.js";
import {
  searchPatterns,
  handlePatternSearch,
  populatePatterns,
  TASK_PATTERNS,
} from "./pattern-vectorize.js";
import {
  syncFromSupabase,
  syncToSupabase,
  fullSync,
  handleSyncPull,
  handleSyncPush,
  handleSyncFull,
  handleSyncStatus,
  handleAddLearning,
  getUserPatternsFromKV,
  getUserLearningsFromKV,
} from "./supabase-sync.js";
import {
  selectToolsSemantic,
  populateToolIndex,
  handleToolSelection,
  handleToolPopulate,
  handleToolDefinitions,
  TOOL_DEFINITIONS,
} from "./tool-vectorize.js";

// =====================================================
// PROMPT TEMPLATE CONSTANTS
// =====================================================
// v7: Bump to sync updated prompts.py and tool schemas (2026-01-22)
const TEMPLATE_VERSION = "v7";
const TEMPLATE_TTL = 86400 * 7; // 7 days (templates are stable)

// =====================================================
// MAIN WORKER ENTRY POINT
// =====================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Standard CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Cache-Key, X-User-Id, X-Session-Id",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const startTime = Date.now();

    try {
      // =====================================================
      // ROUTE HANDLING
      // =====================================================

      // Health check
      if (path === "/health" || path === "/") {
        return jsonResponse(
          {
            status: "healthy",
            timestamp: Date.now(),
            version: "1.0.0",
            environment: env.ENVIRONMENT || "development",
          },
          corsHeaders,
        );
      }

      // Command cache lookup (instant responses for common voice commands)
      if (path === "/api/command" || path === "/api/v1/command") {
        return await handleCommandLookup(request, env, ctx, corsHeaders);
      }

      // Transcription routing (Deepgram with caching)
      if (path === "/api/transcribe" || path === "/api/v1/transcribe") {
        return await handleTranscription(request, env, ctx, corsHeaders, startTime);
      }

      // LLM chat completions (with caching)
      if (path === "/api/chat" || path === "/api/v1/chat") {
        return await handleChat(request, env, ctx, corsHeaders, startTime);
      }

      // =====================================================
      // 🚀 PROMPT TEMPLATE ROUTES - 99% token reduction!
      // =====================================================

      // Initialize/register a prompt template (system prompt + tools)
      if (path === "/api/template/init" || path === "/api/v1/template/init") {
        return await handleTemplateInit(request, env, ctx, corsHeaders, startTime);
      }

      // Get template info (for debugging)
      if (path === "/api/template/info" || path === "/api/v1/template/info") {
        return await handleTemplateInfo(request, env, ctx, corsHeaders);
      }

      // Chat using template (only send user message!)
      if (path === "/api/chat/template" || path === "/api/v1/chat/template") {
        return await handleChatWithTemplate(request, env, ctx, corsHeaders, startTime);
      }

      // Preload default Centris template on first access
      if (path === "/api/template/preload" || path === "/api/v1/template/preload") {
        return await handleTemplatePreload(request, env, ctx, corsHeaders, startTime);
      }

      // Invalidate/clear old template caches (for version upgrades)
      if (path === "/api/template/invalidate" || path === "/api/v1/template/invalidate") {
        return await handleTemplateInvalidate(request, env, ctx, corsHeaders, startTime);
      }

      // =====================================================
      // 🎯 PATTERN VECTORIZE - Complex task matching
      // =====================================================

      // Search for matching complex task patterns
      // Supports both /api/patterns/search and /api/task-patterns/search (alias for orchestrator)
      if (
        path === "/api/patterns/search" ||
        path === "/api/v1/patterns/search" ||
        path === "/api/task-patterns/search" ||
        path === "/api/v1/task-patterns/search"
      ) {
        // Handle parameter aliasing: orchestrator sends 'query', worker expects 'intent'
        let modifiedRequest = request;
        if (path.includes("task-patterns")) {
          try {
            const body = await request.json();
            // Map 'query' to 'intent' for compatibility with orchestrator
            if (body.query && !body.intent) {
              body.intent = body.query;
            }
            modifiedRequest = new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: JSON.stringify(body),
            });
          } catch (e) {
            // If body parsing fails, pass through original request
          }
        }
        const response = await handlePatternSearch(modifiedRequest, env);
        // Add CORS headers to response
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // List all available task patterns
      if (path === "/api/patterns/list" || path === "/api/v1/patterns/list") {
        return jsonResponse(
          {
            success: true,
            patterns: TASK_PATTERNS.map((p) => ({
              id: p.id,
              category: p.category,
              intent: p.intent,
            })),
            totalPatterns: TASK_PATTERNS.length,
          },
          corsHeaders,
        );
      }

      // Populate Vectorize index (admin endpoint)
      if (path === "/api/patterns/populate" || path === "/api/v1/patterns/populate") {
        try {
          const result = await populatePatterns(env);
          return jsonResponse(result, corsHeaders);
        } catch (error) {
          return jsonResponse({ error: error.message }, corsHeaders, 500);
        }
      }

      // =====================================================
      // 🛠️ TOOL-RAG (BigTool Pattern) - Semantic Tool Selection
      // Gulli's 3x improvement in tool selection accuracy
      // =====================================================

      // Select relevant tools via semantic search
      // POST /api/tools/select - { intent: string, topK?: number, minScore?: number }
      // Returns: { tools: [{name, score, category, description}], source: 'vectorize'|'keyword_fallback' }
      if (path === "/api/tools/select" || path === "/api/v1/tools/select") {
        const response = await handleToolSelection(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // Get all tool definitions (for debugging/inspection)
      // GET /api/tools/definitions
      if (path === "/api/tools/definitions" || path === "/api/v1/tools/definitions") {
        const response = await handleToolDefinitions(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // Populate tool Vectorize index (admin endpoint)
      // POST /api/tools/populate
      if (path === "/api/tools/populate" || path === "/api/v1/tools/populate") {
        const response = await handleToolPopulate(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // =====================================================
      // 🎯 CONTEXT VECTORIZE - Instant Context Detection
      // =====================================================
      // Detect user context (what app/window they're looking at)
      // POST /api/context/detect - Instant context detection with optional intent matching
      // Returns context ID, capabilities, available tools, and context prompt

      if (path === "/api/context/detect" || path === "/api/v1/context/detect") {
        const response = await handleContextDetect(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // List all context signatures
      if (path === "/api/context/signatures" || path === "/api/v1/context/signatures") {
        const response = await handleContextList(request);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // Populate context Vectorize index (admin endpoint)
      if (path === "/api/context/populate" || path === "/api/v1/context/populate") {
        const response = await handleContextPopulate(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // Get capabilities for a specific context
      if (path.match(/\/api\/v?1?\/context\/[^/]+\/capabilities/)) {
        const response = await handleContextCapabilities(request);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // LLM provider proxy (for AI Gateway routing)
      if (path.startsWith("/api/proxy/") || path.startsWith("/api/v1/proxy/")) {
        return await handleProviderProxy(request, env, ctx, corsHeaders, startTime);
      }

      // =====================================================
      // 📦 CONTEXT CACHING ROUTES - Domain/User/Session context
      // =====================================================

      // Get domain context package
      if (path === "/api/context/domain" || path === "/api/v1/context/domain") {
        return await handleDomainContext(request, env, ctx, corsHeaders);
      }

      // Get user context (patterns + learnings from KV)
      if (path === "/api/context/user" || path === "/api/v1/context/user") {
        return await handleUserContext(request, env, ctx, corsHeaders);
      }

      // Get/update session context
      if (path === "/api/context/session" || path === "/api/v1/context/session") {
        return await handleSessionContext(request, env, ctx, corsHeaders);
      }

      // Sync user context from backend to KV
      if (path === "/api/context/sync" || path === "/api/v1/context/sync") {
        return await handleContextSync(request, env, ctx, corsHeaders, startTime);
      }

      // Get combined context (domain + user + session in one call)
      if (path === "/api/context/combined" || path === "/api/v1/context/combined") {
        return await handleCombinedContext(request, env, ctx, corsHeaders, startTime);
      }

      // Chat with full context (template + domain + user context)
      if (path === "/api/chat/full-context" || path === "/api/v1/chat/full-context") {
        return await handleChatWithFullContext(request, env, ctx, corsHeaders, startTime);
      }

      // Cache statistics
      if (path === "/api/stats" || path === "/api/v1/stats") {
        return await handleCacheStats(env, corsHeaders);
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 🔄 SUPABASE SYNC ROUTES - Edge ↔ Supabase bi-directional sync
      // @deprecated Use centris_web_memory (Supabase) per docs/MEMORY_ARCHITECTURE.md
      // Gate with CENTRIS_DEPRECATE_OLD_SYNC=1 to return 410 Gone
      // ═══════════════════════════════════════════════════════════════════════
      const oldSyncDeprecated =
        env.CENTRIS_DEPRECATE_OLD_SYNC === "1" || env.CENTRIS_DEPRECATE_OLD_SYNC === "true";
      const isOldSyncPath =
        path === "/api/sync/pull" ||
        path === "/api/v1/sync/pull" ||
        path === "/api/sync/push" ||
        path === "/api/v1/sync/push" ||
        path === "/api/sync/full" ||
        path === "/api/v1/sync/full" ||
        path === "/api/sync/status" ||
        path === "/api/v1/sync/status" ||
        path === "/api/learning/add" ||
        path === "/api/v1/learning/add";
      if (oldSyncDeprecated && isOldSyncPath) {
        return new Response(
          JSON.stringify({
            ok: false,
            deprecated: true,
            code: "DEPRECATED",
            message:
              "Old patterns/learnings sync is deprecated. Use per-user centris_web_memory (Supabase). See docs/MEMORY_ARCHITECTURE.md",
          }),
          {
            status: 410,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      // Pull user data from Supabase to KV (call on login)
      if (path === "/api/sync/pull" || path === "/api/v1/sync/pull") {
        const response = await handleSyncPull(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // Push data from KV/backend to Supabase (call after execution)
      if (path === "/api/sync/push" || path === "/api/v1/sync/push") {
        // Pass ctx for waitUntil background tasks
        env.ctx = ctx;
        const response = await handleSyncPush(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // Full bi-directional sync (call periodically or on demand)
      if (path === "/api/sync/full" || path === "/api/v1/sync/full") {
        const response = await handleSyncFull(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // Get sync status for a user
      if (path === "/api/sync/status" || path === "/api/v1/sync/status") {
        const response = await handleSyncStatus(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // Add a single learning (fast path - updates KV immediately, queues Supabase sync)
      if (path === "/api/learning/add" || path === "/api/v1/learning/add") {
        env.ctx = ctx;
        const response = await handleAddLearning(request, env);
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // VECTORIZE: Command pattern search (learned commands)
      // ═══════════════════════════════════════════════════════════════════════

      // Search for similar command patterns (finds past commands/learnings by meaning)
      // Different from /api/patterns/search which is for task patterns (complex workflows)
      if (path === "/api/command-patterns/search" || path === "/api/v1/command-patterns/search") {
        return await handleCommandPatternSearch(request, env, ctx, corsHeaders, startTime);
      }

      // Index a new pattern (after successful command execution)
      if (path === "/api/patterns/index" || path === "/api/v1/patterns/index") {
        return await handlePatternIndex(request, env, ctx, corsHeaders, startTime);
      }

      // Get instant response for known pattern (execute during speech!)
      if (path === "/api/patterns/instant" || path === "/api/v1/patterns/instant") {
        return await handlePatternInstant(request, env, ctx, corsHeaders, startTime);
      }

      // Export patterns for LLM training data
      if (path === "/api/patterns/export" || path === "/api/v1/patterns/export") {
        return await handlePatternExport(request, env, ctx, corsHeaders, startTime);
      }

      // Get pattern statistics
      if (path === "/api/patterns/stats" || path === "/api/v1/patterns/stats") {
        return await handlePatternStats(request, env, ctx, corsHeaders);
      }

      // Bulk index patterns (for seeding from training data)
      if (path === "/api/patterns/bulk-index" || path === "/api/v1/patterns/bulk-index") {
        return await handlePatternBulkIndex(request, env, ctx, corsHeaders, startTime);
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 🌱 PATTERN SEEDING & FAILURE TRACKING - Self-improving system
      // ═══════════════════════════════════════════════════════════════════════

      // Seed simple patterns (admin endpoint - populates KV + Vectorize)
      if (path === "/api/patterns/seed" || path === "/api/v1/patterns/seed") {
        return await handlePatternSeed(request, env, ctx, corsHeaders, startTime);
      }

      // Record execution result (verify success/failure and update tracking)
      if (path === "/api/patterns/verify" || path === "/api/v1/patterns/verify") {
        return await handlePatternVerify(request, env, ctx, corsHeaders, startTime);
      }

      // Get known failures list (patterns to skip in instant execution)
      if (path === "/api/patterns/failures" || path === "/api/v1/patterns/failures") {
        return await handlePatternFailures(request, env, ctx, corsHeaders);
      }

      // Contribute a new pattern (learning loop from successful LLM parses)
      if (path === "/api/patterns/contribute" || path === "/api/v1/patterns/contribute") {
        return await handlePatternContribute(request, env, ctx, corsHeaders, startTime);
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 🎓 TASK PATTERN LEARNING ROUTES - Self-improving system
      // These handle COMPLEX workflow patterns (5+ steps, decisions, recovery)
      // ═══════════════════════════════════════════════════════════════════════

      // Index a learned task pattern (from successful complex execution)
      if (path === "/api/task-patterns/index" || path === "/api/v1/task-patterns/index") {
        return await handleTaskPatternIndex(request, env, ctx, corsHeaders, startTime);
      }

      // Search for similar task patterns (returns workflow scaffolds)
      if (path === "/api/task-patterns/search" || path === "/api/v1/task-patterns/search") {
        return await handleTaskPatternSearch(request, env, ctx, corsHeaders, startTime);
      }

      // Get task pattern statistics
      if (path === "/api/task-patterns/stats" || path === "/api/v1/task-patterns/stats") {
        return await handleTaskPatternStats(request, env, ctx, corsHeaders);
      }

      // Export execution logs (detailed training data with full traces)
      if (path === "/api/executions/export" || path === "/api/v1/executions/export") {
        return await handleExecutionExport(request, env, ctx, corsHeaders, startTime);
      }

      // Get execution log for a specific date
      if (path === "/api/executions/daily" || path === "/api/v1/executions/daily") {
        return await handleDailyExecutions(request, env, ctx, corsHeaders, startTime);
      }

      // =====================================================
      // 🎙️ DICTATION MODE ROUTES - Voice-to-text cleanup
      // =====================================================

      // Dictation text cleanup (cached template + aggressive LLM caching)
      if (path === "/api/dictation/cleanup" || path === "/api/v1/dictation/cleanup") {
        return await handleDictationCleanup(request, env, ctx, corsHeaders, startTime);
      }

      // Initialize dictation cleanup template
      if (path === "/api/dictation/template/init" || path === "/api/v1/dictation/template/init") {
        return await handleDictationTemplateInit(request, env, ctx, corsHeaders, startTime);
      }

      // =====================================================
      // 📖 READING MODE ROUTES - Text-to-voice
      // =====================================================

      // Reading summarization (cached template + semantic caching)
      if (path === "/api/reading/summarize" || path === "/api/v1/reading/summarize") {
        return await handleReadingSummarize(request, env, ctx, corsHeaders, startTime);
      }

      // Vision-based text extraction (for OCR/screenshot reading)
      if (path === "/api/reading/vision" || path === "/api/v1/reading/vision") {
        return await handleReadingVision(request, env, ctx, corsHeaders, startTime);
      }

      // Initialize reading templates (summarization + vision prompts)
      if (path === "/api/reading/template/init" || path === "/api/v1/reading/template/init") {
        return await handleReadingTemplateInit(request, env, ctx, corsHeaders, startTime);
      }

      // 404 for unknown routes
      return jsonResponse({ error: "Not Found", path }, corsHeaders, 404);
    } catch (error) {
      console.error("Worker error:", error);
      return jsonResponse(
        {
          error: "Internal Server Error",
          message: error.message,
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
        500,
      );
    }
  },
};

// =====================================================
// COMMAND CACHE HANDLER (Instant responses)
// =====================================================

/**
 * Handle command cache lookup for instant voice command responses.
 * Returns cached action if command matches, otherwise returns null.
 */
async function handleCommandLookup(request, env, ctx, corsHeaders) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const { command, transcript } = body;
  const input = command || transcript;

  if (!input) {
    return jsonResponse({ error: "Command or transcript required" }, corsHeaders, 400);
  }

  // Check command cache
  const match = matchCommand(input);

  if (match.matched) {
    // Increment cache hit counter
    ctx.waitUntil(incrementCacheStats(env, "command_hits"));

    return jsonResponse(
      {
        matched: true,
        command: match.command,
        confidence: match.confidence,
        cached: true,
        latency_ms: 0,
      },
      corsHeaders,
    );
  }

  // No match - caller should proceed to LLM
  return jsonResponse(
    {
      matched: false,
      suggestion: "proceed_to_llm",
    },
    corsHeaders,
  );
}

// =====================================================
// TRANSCRIPTION HANDLER (Deepgram with caching)
// =====================================================

/**
 * Handle transcription requests.
 * Routes to Deepgram and caches identical audio.
 */
async function handleTranscription(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  // Parse request - could be JSON (with base64 audio) or FormData
  let audioBytes;
  let language = "en";
  let provider = "deepgram";

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const audioFile = formData.get("audio") || formData.get("file");
    language = formData.get("language") || "en";
    provider = formData.get("provider") || "deepgram";

    if (!audioFile) {
      return jsonResponse({ error: "No audio file provided" }, corsHeaders, 400);
    }

    audioBytes = await audioFile.arrayBuffer();
  } else {
    // JSON with base64 audio
    const body = await request.json();
    language = body.language || "en";
    provider = body.provider || "deepgram";

    if (body.audio_base64) {
      audioBytes = base64ToArrayBuffer(body.audio_base64);
    } else if (body.audio_bytes) {
      audioBytes = new Uint8Array(body.audio_bytes).buffer;
    } else {
      return jsonResponse({ error: "audio_base64 or audio_bytes required" }, corsHeaders, 400);
    }
  }

  // Generate cache key from audio hash
  const audioHash = await hashArrayBuffer(audioBytes);
  const cacheKey = `transcription:${provider}:${language}:${audioHash}`;

  // Check cache
  if (env.ENABLE_TRANSCRIPTION_CACHING === "true" && env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      ctx.waitUntil(incrementCacheStats(env, "transcription_hits"));

      return jsonResponse(
        {
          text: cached,
          cached: true,
          cache_key: audioHash.slice(0, 8),
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }
  }

  // Route to provider
  let transcript;

  if (provider === "deepgram") {
    transcript = await transcribeWithDeepgram(audioBytes, language, env);
  } else if (provider === "whisper" || provider === "workers-ai") {
    transcript = await transcribeWithWorkersAI(audioBytes, env);
  } else {
    return jsonResponse({ error: `Unknown provider: ${provider}` }, corsHeaders, 400);
  }

  const latency = Date.now() - startTime;

  // Cache the result
  if (env.ENABLE_TRANSCRIPTION_CACHING === "true" && env.CACHE && transcript) {
    const ttl = parseInt(env.TRANSCRIPTION_CACHE_TTL || "3600", 10);
    ctx.waitUntil(env.CACHE.put(cacheKey, transcript, { expirationTtl: ttl }));
    ctx.waitUntil(incrementCacheStats(env, "transcription_misses"));
  }

  return jsonResponse(
    {
      text: transcript,
      cached: false,
      provider,
      latency_ms: latency,
    },
    corsHeaders,
  );
}

/**
 * Transcribe audio using Deepgram API.
 */
async function transcribeWithDeepgram(audioBytes, language, env) {
  const apiKey = env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY not configured");
  }

  const response = await fetch("https://api.deepgram.com/v1/listen", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "audio/wav",
    },
    body: audioBytes,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Deepgram error: ${error}`);
  }

  const result = await response.json();

  if (result.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
    return result.results.channels[0].alternatives[0].transcript;
  }

  return "";
}

/**
 * Transcribe audio using Workers AI Whisper (fallback).
 */
async function transcribeWithWorkersAI(audioBytes, env) {
  if (!env.AI) {
    throw new Error("Workers AI not configured");
  }

  const result = await env.AI.run("@cf/openai/whisper", {
    audio: [...new Uint8Array(audioBytes)],
  });

  return result.text || "";
}

// =====================================================
// LLM CHAT HANDLER (with caching)
// =====================================================

/**
 * Handle LLM chat completion requests.
 * Routes through AI Gateway for caching and analytics.
 */
async function handleChat(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    messages,
    model = "deepseek-chat",
    provider = "deepseek",
    temperature = 0.7,
    max_tokens,
    tools,
    tool_choice,
  } = body;

  if (!messages || !Array.isArray(messages)) {
    return jsonResponse({ error: "Messages array required" }, corsHeaders, 400);
  }

  // Generate cache key for requests
  const cacheKey = generateChatCacheKey(messages, model, temperature, tools);

  // =====================================================
  // AGGRESSIVE CACHING MODE
  // =====================================================
  // Cache ALL requests (even temperature > 0) with different TTLs:
  // - temperature = 0: 24 hours (deterministic)
  // - temperature <= 0.3: 4 hours (low variance)
  // - temperature <= 0.7: 1 hour (moderate variance)
  // - temperature > 0.7: 15 minutes (high variance)
  //
  // This dramatically increases cache hit rate while still
  // providing some variety for non-deterministic requests.
  // =====================================================

  const aggressiveCaching = env.ENABLE_AGGRESSIVE_CACHING === "true";
  const shouldCache = env.ENABLE_LLM_CACHING === "true" && env.CACHE;

  // Determine if we should check cache (aggressive mode caches everything)
  const checkCache = shouldCache && (temperature === 0 || aggressiveCaching);

  if (checkCache) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      ctx.waitUntil(incrementCacheStats(env, "llm_hits"));

      const cachedResponse = JSON.parse(cached);
      return jsonResponse(
        {
          ...cachedResponse,
          cached: true,
          cache_key: cacheKey.slice(0, 16),
          cache_mode: aggressiveCaching ? "aggressive" : "deterministic",
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }
  }

  // Route to provider
  let response;

  if (provider === "workers-ai") {
    response = await callWorkersAI(env, messages, model);
  } else {
    response = await callExternalProvider(
      provider,
      messages,
      model,
      temperature,
      max_tokens,
      tools,
      tool_choice,
      env,
    );
  }

  const latency = Date.now() - startTime;

  // Cache responses based on mode
  if (shouldCache && response.choices?.[0]?.message) {
    // Determine TTL based on temperature
    let ttl;
    if (temperature === 0) {
      ttl = parseInt(env.LLM_CACHE_TTL || "86400", 10); // 24 hours for deterministic
    } else if (aggressiveCaching) {
      // Variable TTL based on temperature for non-deterministic
      if (temperature <= 0.3) {
        ttl = 14400; // 4 hours for low temp
      } else if (temperature <= 0.7) {
        ttl = 3600; // 1 hour for medium temp
      } else {
        ttl = 900; // 15 minutes for high temp
      }
    } else {
      ttl = 0; // Don't cache non-deterministic in conservative mode
    }

    if (ttl > 0) {
      ctx.waitUntil(env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: ttl }));
      ctx.waitUntil(incrementCacheStats(env, "llm_misses"));
    }
  }

  return jsonResponse(
    {
      ...response,
      cached: false,
      provider,
      latency_ms: latency,
    },
    corsHeaders,
  );
}

/**
 * Call Workers AI for inference.
 */
async function callWorkersAI(env, messages, model) {
  if (!env.AI) {
    throw new Error("Workers AI not configured");
  }

  const modelMap = {
    "llama-3-8b": "@cf/meta/llama-3-8b-instruct",
    "llama-3-70b": "@cf/meta/llama-3-70b-instruct",
    "mistral-7b": "@cf/mistral/mistral-7b-instruct-v0.1",
  };

  const workersModel = modelMap[model] || modelMap["llama-3-8b"];

  const result = await env.AI.run(workersModel, { messages });

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: result.response,
        },
        finish_reason: "stop",
      },
    ],
    model: workersModel,
    usage: {},
  };
}

/**
 * Call external LLM provider through Cloudflare AI Gateway.
 *
 * AI Gateway provides:
 * - Semantic caching (30-50% cost reduction)
 * - Request logging and analytics
 * - Rate limiting
 * - Provider failover
 *
 * Gateway URL format:
 * https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_name}/{provider}/chat/completions
 */
async function callExternalProvider(
  provider,
  messages,
  model,
  temperature,
  max_tokens,
  tools,
  tool_choice,
  env,
) {
  // Cloudflare AI Gateway configuration
  const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID || "7cd2b493d94c63bba7fb6b1813984ce0";
  const GATEWAY_SLUG = env.AI_GATEWAY_SLUG || "centris-ai-gateway";
  const USE_AI_GATEWAY = env.USE_AI_GATEWAY !== "false"; // Default to true

  // AI Gateway base URL
  const AI_GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}`;

  const configs = {
    openai: {
      // AI Gateway URL for OpenAI
      gatewayUrl: `${AI_GATEWAY_BASE}/openai/chat/completions`,
      directUrl: "https://api.openai.com/v1/chat/completions",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      keyEnv: "OPENAI_API_KEY",
    },
    anthropic: {
      // AI Gateway URL for Anthropic
      gatewayUrl: `${AI_GATEWAY_BASE}/anthropic/messages`,
      directUrl: "https://api.anthropic.com/v1/messages",
      authHeader: "x-api-key",
      authPrefix: "",
      keyEnv: "ANTHROPIC_API_KEY",
      extraHeaders: { "anthropic-version": "2024-01-01" },
      transformRequest: transformForAnthropic,
      transformResponse: transformFromAnthropic,
    },
    deepseek: {
      // AI Gateway URL for DeepSeek
      gatewayUrl: `${AI_GATEWAY_BASE}/deepseek/chat/completions`,
      directUrl: "https://api.deepseek.com/v1/chat/completions",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      keyEnv: "DEEPSEEK_API_KEY",
    },
    gemini: {
      // AI Gateway URL for Google AI Studio (Gemini)
      gatewayUrl: `${AI_GATEWAY_BASE}/google-ai-studio/v1beta/models/${model}:generateContent`,
      directUrl: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      authHeader: null, // Uses query param
      keyEnv: "GEMINI_API_KEY",
      transformRequest: transformForGemini,
      transformResponse: transformFromGemini,
    },
  };

  const config = configs[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const apiKey = env[config.keyEnv];
  if (!apiKey) {
    throw new Error(`API key not configured for ${provider}`);
  }

  // Build headers
  const headers = {
    "Content-Type": "application/json",
    ...config.extraHeaders,
  };

  if (config.authHeader) {
    headers[config.authHeader] = `${config.authPrefix}${apiKey}`;
  }

  // Choose URL: AI Gateway (for caching/analytics) or Direct
  let url;
  if (USE_AI_GATEWAY) {
    url = config.gatewayUrl;
    // AI Gateway caching headers
    headers["cf-aig-cache-ttl"] = "3600"; // 1 hour cache
    headers["cf-aig-skip-cache"] = "false";
    console.log(`[AI Gateway] Routing ${provider} through gateway: ${url}`);
  } else {
    url = config.directUrl;
    console.log(`[Direct] Calling ${provider} directly: ${url}`);
  }

  // Gemini uses query param for API key (both gateway and direct)
  if (provider === "gemini") {
    url = `${url}?key=${apiKey}`;
  }

  // Build payload
  let payload = {
    model,
    messages,
    temperature,
    ...(max_tokens && { max_tokens }),
    ...(tools && { tools }),
    ...(tool_choice && { tool_choice }),
  };

  // Transform request if needed
  if (config.transformRequest) {
    payload = config.transformRequest(payload);
  }

  // Make request
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();

    // If AI Gateway fails, try direct as fallback
    if (USE_AI_GATEWAY && !url.includes("api.")) {
      console.warn(`[AI Gateway] Failed, falling back to direct: ${error}`);
      return callExternalProviderDirect(
        provider,
        messages,
        model,
        temperature,
        max_tokens,
        tools,
        tool_choice,
        env,
        config,
        apiKey,
      );
    }

    throw new Error(`Provider ${provider} error: ${error}`);
  }

  let result = await response.json();

  // Transform response if needed
  if (config.transformResponse) {
    result = config.transformResponse(result);
  }

  // Add gateway metadata
  result._gateway = {
    used: USE_AI_GATEWAY,
    provider,
    cacheStatus: response.headers.get("cf-aig-cache-status") || "unknown",
  };

  return result;
}

/**
 * Direct API call (fallback when AI Gateway fails).
 */
async function callExternalProviderDirect(
  provider,
  messages,
  model,
  temperature,
  max_tokens,
  tools,
  tool_choice,
  env,
  config,
  apiKey,
) {
  const headers = {
    "Content-Type": "application/json",
    ...config.extraHeaders,
  };

  if (config.authHeader) {
    headers[config.authHeader] = `${config.authPrefix}${apiKey}`;
  }

  let url = config.directUrl;
  if (provider === "gemini") {
    url = `${url}?key=${apiKey}`;
  }

  let payload = {
    model,
    messages,
    temperature,
    ...(max_tokens && { max_tokens }),
    ...(tools && { tools }),
    ...(tool_choice && { tool_choice }),
  };

  if (config.transformRequest) {
    payload = config.transformRequest(payload);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Provider ${provider} direct error: ${error}`);
  }

  let result = await response.json();

  if (config.transformResponse) {
    result = config.transformResponse(result);
  }

  result._gateway = {
    used: false,
    provider,
    fallback: true,
  };

  return result;
}

// =====================================================
// PROVIDER PROXY HANDLER
// =====================================================

/**
 * Handle direct provider proxy requests.
 * Useful for streaming responses or custom requests.
 */
async function handleProviderProxy(request, env, ctx, corsHeaders, startTime) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  // /api/proxy/{provider}/{...rest} or /api/v1/proxy/{provider}/{...rest}
  const providerIndex = pathParts.includes("v1") ? 4 : 3;
  const provider = pathParts[providerIndex];

  if (!provider) {
    return jsonResponse({ error: "Provider required in path" }, corsHeaders, 400);
  }

  // Clone and forward request to provider
  const body = await request.text();

  // Get provider config
  const providerUrls = {
    openai: "https://api.openai.com",
    anthropic: "https://api.anthropic.com",
    deepseek: "https://api.deepseek.com",
    gemini: "https://generativelanguage.googleapis.com",
    deepgram: "https://api.deepgram.com",
  };

  const baseUrl = providerUrls[provider];
  if (!baseUrl) {
    return jsonResponse({ error: `Unknown provider: ${provider}` }, corsHeaders, 400);
  }

  // Build target URL
  const restPath = pathParts.slice(providerIndex + 1).join("/");
  const targetUrl = `${baseUrl}/${restPath}${url.search}`;

  // Forward request
  const headers = new Headers(request.headers);
  headers.delete("host");

  const proxyResponse = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: body || undefined,
  });

  // Return response with CORS headers
  const responseHeaders = new Headers(proxyResponse.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  return new Response(proxyResponse.body, {
    status: proxyResponse.status,
    headers: responseHeaders,
  });
}

// =====================================================
// 🚀 PROMPT TEMPLATE HANDLERS - 99% Token Reduction!
// =====================================================

/**
 * Initialize/register a prompt template.
 *
 * Stores the full system prompt + tool schemas in KV so subsequent
 * requests only need to send the user message (~100 tokens vs ~6,500).
 *
 * Request:
 *   POST /api/template/init
 *   {
 *     template_name: "centris-main" (optional, defaults to "default"),
 *     system_prompt: "You are Centris AI...",
 *     tools: [...tool definitions...],
 *     version: "v1" (optional)
 *   }
 *
 * Response:
 *   {
 *     template_id: "centris-main-v1-abc123",
 *     token_estimate: {system_prompt: 3500, tools: 3000, total: 6500},
 *     cached: true
 *   }
 */
async function handleTemplateInit(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    template_name = "default",
    system_prompt,
    tools,
    version = TEMPLATE_VERSION,
    provider = "deepseek", // Default provider for this template
    model = "deepseek-chat", // Default model for this template
  } = body;

  if (!system_prompt) {
    return jsonResponse({ error: "system_prompt required" }, corsHeaders, 400);
  }

  // Generate template ID based on content hash for deduplication
  const contentHash = await hashString(JSON.stringify({ system_prompt, tools }));
  const templateId = `${template_name}-${version}-${contentHash.slice(0, 8)}`;

  // Estimate token counts (rough: 4 chars per token)
  const systemPromptTokens = Math.ceil(system_prompt.length / 4);
  const toolsTokens = tools ? Math.ceil(JSON.stringify(tools).length / 4) : 0;
  const totalTokens = systemPromptTokens + toolsTokens;

  // Check if already cached
  const existingTemplate = await env.CACHE?.get(`template:${templateId}`);
  if (existingTemplate) {
    ctx.waitUntil(incrementCacheStats(env, "template_hits"));

    return jsonResponse(
      {
        template_id: templateId,
        already_cached: true,
        token_estimate: {
          system_prompt: systemPromptTokens,
          tools: toolsTokens,
          total: totalTokens,
          savings_per_request: totalTokens,
        },
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  // Store template in KV
  const template = {
    template_id: templateId,
    template_name,
    version,
    system_prompt,
    tools: tools || [],
    provider,
    model,
    created_at: new Date().toISOString(),
    token_estimate: totalTokens,
  };

  if (env.CACHE) {
    await env.CACHE.put(`template:${templateId}`, JSON.stringify(template), {
      expirationTtl: TEMPLATE_TTL,
    });

    // Also store a "latest" pointer for easy lookup
    await env.CACHE.put(`template:${template_name}:latest`, templateId, {
      expirationTtl: TEMPLATE_TTL,
    });

    ctx.waitUntil(incrementCacheStats(env, "template_misses"));
  }

  console.log(`[Template] Initialized: ${templateId} (${totalTokens} tokens saved per request)`);

  return jsonResponse(
    {
      template_id: templateId,
      already_cached: false,
      token_estimate: {
        system_prompt: systemPromptTokens,
        tools: toolsTokens,
        total: totalTokens,
        savings_per_request: totalTokens,
      },
      message: `Template cached! Future requests will save ~${totalTokens} tokens.`,
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Get template info for debugging.
 */
async function handleTemplateInfo(request, env, ctx, corsHeaders) {
  const url = new URL(request.url);
  const templateId = url.searchParams.get("id");
  const templateName = url.searchParams.get("name");

  if (!templateId && !templateName) {
    return jsonResponse({ error: "id or name parameter required" }, corsHeaders, 400);
  }

  let lookupId = templateId;

  // If name provided, resolve to latest template ID
  if (templateName && !templateId) {
    lookupId = await env.CACHE?.get(`template:${templateName}:latest`);
    if (!lookupId) {
      return jsonResponse({ error: `Template '${templateName}' not found` }, corsHeaders, 404);
    }
  }

  const template = await env.CACHE?.get(`template:${lookupId}`, { type: "json" });

  if (!template) {
    return jsonResponse({ error: `Template '${lookupId}' not found` }, corsHeaders, 404);
  }

  return jsonResponse(
    {
      template_id: template.template_id,
      template_name: template.template_name,
      version: template.version,
      provider: template.provider,
      model: template.model,
      created_at: template.created_at,
      token_estimate: template.token_estimate,
      // Don't return full content (too large), just stats
      system_prompt_length: template.system_prompt?.length || 0,
      tools_count: template.tools?.length || 0,
    },
    corsHeaders,
  );
}

/**
 * Invalidate/clear old template caches.
 *
 * Used during version upgrades (e.g., v1 → v2) to clear old cached templates
 * and force fresh templates with new compressed prompts/tools.
 *
 * POST /api/template/invalidate
 * {
 *   "version": "v1",           // Version to invalidate (default: previous version)
 *   "template_name": "default" // Optional: specific template name to invalidate
 * }
 *
 * Response:
 * {
 *   "invalidated": true,
 *   "version": "v1",
 *   "current_version": "v2",
 *   "message": "Old v1 templates invalidated. New requests will use v2."
 * }
 */
async function handleTemplateInvalidate(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json().catch(() => ({}));
  const {
    version = "v6", // Default to invalidating v6 (previous version)
    template_name,
  } = body;

  if (!env.CACHE) {
    return jsonResponse({ error: "KV cache not configured" }, corsHeaders, 500);
  }

  const invalidated = [];
  const errors = [];

  try {
    // If specific template_name provided, invalidate just that
    if (template_name) {
      // Delete the "latest" pointer for this template
      const latestKey = `template:${template_name}:latest`;
      const latestTemplateId = await env.CACHE.get(latestKey);

      if (latestTemplateId && latestTemplateId.includes(`-${version}-`)) {
        await env.CACHE.delete(latestKey);
        await env.CACHE.delete(`template:${latestTemplateId}`);
        invalidated.push(latestTemplateId);
      }
    } else {
      // List all keys and delete v1 templates
      // Note: KV list is eventually consistent, some keys might not appear immediately
      const list = await env.CACHE.list({ prefix: "template:" });

      for (const key of list.keys) {
        if (key.name.includes(`-${version}-`)) {
          await env.CACHE.delete(key.name);
          invalidated.push(key.name);
        }
      }

      // Also clear any "latest" pointers that point to v1 templates
      for (const key of list.keys) {
        if (key.name.endsWith(":latest")) {
          const latestId = await env.CACHE.get(key.name);
          if (latestId && latestId.includes(`-${version}-`)) {
            await env.CACHE.delete(key.name);
            invalidated.push(key.name);
          }
        }
      }
    }
  } catch (error) {
    errors.push(error.message);
  }

  ctx.waitUntil(incrementCacheStats(env, "template_invalidations"));

  return jsonResponse(
    {
      invalidated: invalidated.length > 0,
      version_invalidated: version,
      current_version: TEMPLATE_VERSION,
      keys_deleted: invalidated.length,
      invalidated_keys: invalidated.slice(0, 10), // Show first 10 for debugging
      errors: errors.length > 0 ? errors : undefined,
      message:
        invalidated.length > 0
          ? `${invalidated.length} ${version} templates invalidated. New requests will use ${TEMPLATE_VERSION}.`
          : `No ${version} templates found to invalidate.`,
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Chat using a pre-cached template.
 *
 * This is the KEY optimization: instead of sending ~6,500 tokens per request,
 * we only send the user message (~100 tokens) and load the template from KV.
 *
 * Request:
 *   POST /api/chat/template
 *   {
 *     template_id: "centris-main-v1-abc123" (or template_name: "default"),
 *     user_message: "Go to Gmail and read my emails",
 *     conversation_history: [...optional previous messages...],
 *     temperature: 0.7,
 *     max_tokens: 4096,
 *   }
 *
 * The worker loads the template (system_prompt + tools) from KV and
 * constructs the full message array before calling the LLM.
 */
async function handleChatWithTemplate(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    template_id,
    template_name = "default",
    user_message,
    conversation_history = [],
    temperature = 0.7,
    max_tokens,
    tool_choice,
    // Optional overrides
    provider: providerOverride,
    model: modelOverride,
  } = body;

  if (!user_message) {
    return jsonResponse({ error: "user_message required" }, corsHeaders, 400);
  }

  // Resolve template ID
  let resolvedTemplateId = template_id;
  if (!resolvedTemplateId) {
    resolvedTemplateId = await env.CACHE?.get(`template:${template_name}:latest`);
    if (!resolvedTemplateId) {
      return jsonResponse(
        {
          error: `Template '${template_name}' not found. Initialize it first via /api/template/init`,
          suggestion: "Call /api/template/init with system_prompt and tools to create a template.",
        },
        corsHeaders,
        404,
      );
    }
  }

  // Load template from KV (fast: ~1-5ms)
  const templateLoadStart = Date.now();
  const template = await env.CACHE?.get(`template:${resolvedTemplateId}`, { type: "json" });
  const templateLoadTime = Date.now() - templateLoadStart;

  if (!template) {
    return jsonResponse({ error: `Template '${resolvedTemplateId}' not found` }, corsHeaders, 404);
  }

  // Track template chat usage
  ctx.waitUntil(incrementCacheStats(env, "template_chat_hits"));

  // Use template defaults or overrides
  const provider = providerOverride || template.provider || "deepseek";
  const model = modelOverride || template.model || "deepseek-chat";

  // Construct full message array from template + user message
  const messages = [
    // System prompt from template
    { role: "system", content: template.system_prompt },
    // Conversation history (if any)
    ...conversation_history,
    // New user message
    { role: "user", content: user_message },
  ];

  // Log optimization stats
  const userTokens = Math.ceil(user_message.length / 4);
  const historyTokens = Math.ceil(JSON.stringify(conversation_history).length / 4);
  const savedTokens = template.token_estimate;

  console.log(
    `[Template Chat] ${resolvedTemplateId}: Sent ${userTokens + historyTokens} tokens (saved ~${savedTokens} tokens!)`,
  );

  // Generate cache key for this specific request
  const cacheKey = generateChatCacheKey(messages, model, temperature, template.tools);

  // Check response cache (for identical requests)
  const aggressiveCaching = env.ENABLE_AGGRESSIVE_CACHING === "true";
  const shouldCache = env.ENABLE_LLM_CACHING === "true" && env.CACHE;
  const checkCache = shouldCache && (temperature === 0 || aggressiveCaching);

  if (checkCache) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      ctx.waitUntil(incrementCacheStats(env, "llm_hits"));
      ctx.waitUntil(incrementCacheStats(env, "template_chat_cache_hits"));

      const cachedResponse = JSON.parse(cached);
      return jsonResponse(
        {
          ...cachedResponse,
          cached: true,
          template_used: resolvedTemplateId,
          tokens_saved: savedTokens,
          template_load_ms: templateLoadTime,
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }
  }

  // Call LLM with full context (template + user message)
  const llmStart = Date.now();
  let response;

  if (provider === "workers-ai") {
    response = await callWorkersAI(env, messages, model);
  } else {
    response = await callExternalProvider(
      provider,
      messages,
      model,
      temperature,
      max_tokens,
      template.tools,
      tool_choice,
      env,
    );
  }

  const llmTime = Date.now() - llmStart;

  // Cache response based on temperature
  if (shouldCache && response.choices?.[0]?.message) {
    let ttl;
    if (temperature === 0) {
      ttl = parseInt(env.LLM_CACHE_TTL || "86400", 10);
    } else if (aggressiveCaching) {
      if (temperature <= 0.3) {
        ttl = 14400;
      } else if (temperature <= 0.7) {
        ttl = 3600;
      } else {
        ttl = 900;
      }
    } else {
      ttl = 0;
    }

    if (ttl > 0) {
      ctx.waitUntil(env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: ttl }));
      ctx.waitUntil(incrementCacheStats(env, "llm_misses"));
    }
  }

  return jsonResponse(
    {
      ...response,
      cached: false,
      template_used: resolvedTemplateId,
      tokens_saved: savedTokens,
      tokens_sent: userTokens + historyTokens,
      optimization: {
        traditional_tokens: savedTokens + userTokens + historyTokens,
        actual_tokens_sent: userTokens + historyTokens,
        reduction_percent: Math.round(
          (savedTokens / (savedTokens + userTokens + historyTokens)) * 100,
        ),
      },
      timing: {
        template_load_ms: templateLoadTime,
        llm_call_ms: llmTime,
        total_ms: Date.now() - startTime,
      },
      provider,
      model,
    },
    corsHeaders,
  );
}

/**
 * Preload the default Centris template.
 *
 * This endpoint allows the backend to initialize the Centris system prompt
 * and tools as a template on startup, ensuring instant chat responses.
 */
async function handleTemplatePreload(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const { system_prompt, tools, force_refresh = false } = body;

  if (!system_prompt) {
    return jsonResponse({ error: "system_prompt required" }, corsHeaders, 400);
  }

  // Check if default template already exists
  if (!force_refresh) {
    const existingId = await env.CACHE?.get("template:default:latest");
    if (existingId) {
      const existing = await env.CACHE?.get(`template:${existingId}`, { type: "json" });
      if (existing) {
        return jsonResponse(
          {
            template_id: existingId,
            already_cached: true,
            created_at: existing.created_at,
            token_estimate: existing.token_estimate,
            message: "Default template already exists. Use force_refresh=true to update.",
            latency_ms: Date.now() - startTime,
          },
          corsHeaders,
        );
      }
    }
  }

  // Initialize as default template
  const result = await handleTemplateInit(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        template_name: "default",
        system_prompt,
        tools,
        version: TEMPLATE_VERSION,
      }),
    }),
    env,
    ctx,
    corsHeaders,
    startTime,
  );

  return result;
}

// =====================================================
// CACHE STATS HANDLER
// =====================================================

/**
 * Get cache statistics.
 */
async function handleCacheStats(env, corsHeaders) {
  if (!env.CACHE) {
    return jsonResponse({ error: "Cache not configured" }, corsHeaders, 500);
  }

  const stats = await env.CACHE.get("__stats__", { type: "json" });

  const defaultStats = {
    llm_hits: 0,
    llm_misses: 0,
    transcription_hits: 0,
    transcription_misses: 0,
    command_hits: 0,
    // Template caching stats
    template_hits: 0, // Template already existed on init
    template_misses: 0, // New template created
    template_chat_hits: 0, // Chat requests using templates
    template_chat_cache_hits: 0, // Template chat + response cache hit
    // Dictation mode stats
    dictation_template_hits: 0,
    dictation_template_misses: 0,
    dictation_cleanup_hits: 0, // Cached cleanup results
    dictation_cleanup_misses: 0, // New cleanup (LLM called)
    // Reading mode stats
    reading_template_hits: 0,
    reading_template_misses: 0,
    reading_summarize_hits: 0, // Cached summaries
    reading_summarize_misses: 0, // New summaries (LLM called)
    reading_vision_successes: 0, // Successful vision extractions
    reading_vision_failures: 0, // Failed vision extractions
    last_updated: null,
  };

  const mergedStats = { ...defaultStats, ...stats };

  // Calculate derived metrics
  const totalTemplateChats = mergedStats.template_chat_hits || 0;
  const templateCacheHits = mergedStats.template_chat_cache_hits || 0;
  const totalLlmRequests = mergedStats.llm_hits + mergedStats.llm_misses;

  // Dictation mode metrics
  const totalDictationCleanups =
    mergedStats.dictation_cleanup_hits + mergedStats.dictation_cleanup_misses;
  const dictationCacheHitRate =
    totalDictationCleanups > 0
      ? Math.round((mergedStats.dictation_cleanup_hits / totalDictationCleanups) * 100)
      : 0;

  // Reading mode metrics
  const totalReadingSummarizations =
    mergedStats.reading_summarize_hits + mergedStats.reading_summarize_misses;
  const readingSummarizeCacheHitRate =
    totalReadingSummarizations > 0
      ? Math.round((mergedStats.reading_summarize_hits / totalReadingSummarizations) * 100)
      : 0;
  const totalVisionExtractions =
    mergedStats.reading_vision_successes + mergedStats.reading_vision_failures;
  const visionSuccessRate =
    totalVisionExtractions > 0
      ? Math.round((mergedStats.reading_vision_successes / totalVisionExtractions) * 100)
      : 0;

  // Estimate token savings from template usage
  // Average template size ~6,500 tokens, user message ~100 tokens
  const avgTemplateSavings = 6400; // tokens saved per template chat
  const estimatedTokensSaved = totalTemplateChats * avgTemplateSavings;

  return jsonResponse(
    {
      ...mergedStats,
      // Derived metrics
      metrics: {
        llm_cache_hit_rate:
          totalLlmRequests > 0
            ? `${Math.round((mergedStats.llm_hits / totalLlmRequests) * 100)}%`
            : "N/A",
        template_cache_hit_rate:
          totalTemplateChats > 0
            ? `${Math.round((templateCacheHits / totalTemplateChats) * 100)}%`
            : "N/A",
        estimated_tokens_saved: estimatedTokensSaved,
        estimated_cost_saved: `$${(estimatedTokensSaved * 0.000002).toFixed(4)}`, // ~$2/1M tokens
      },
      // Dictation mode metrics
      dictation_metrics: {
        total_cleanups: totalDictationCleanups,
        cache_hit_rate: `${dictationCacheHitRate}%`,
        template_initialized:
          mergedStats.dictation_template_hits > 0 || mergedStats.dictation_template_misses > 0,
      },
      // Reading mode metrics
      reading_metrics: {
        total_summarizations: totalReadingSummarizations,
        summarize_cache_hit_rate: `${readingSummarizeCacheHitRate}%`,
        total_vision_extractions: totalVisionExtractions,
        vision_success_rate: `${visionSuccessRate}%`,
        template_initialized:
          mergedStats.reading_template_hits > 0 || mergedStats.reading_template_misses > 0,
      },
    },
    corsHeaders,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATS BATCHING - Reduces KV writes from 1/request to ~1/100 requests
// ═══════════════════════════════════════════════════════════════════════════════
// Stats are aggregated in memory and flushed every 100 increments or 5 minutes.
// This reduces stats KV writes by ~99% without losing accuracy.
// ═══════════════════════════════════════════════════════════════════════════════

const STATS_FLUSH_THRESHOLD = 100; // Flush after N increments
const STATS_FLUSH_INTERVAL_MS = 300000; // Or flush every 5 minutes
let pendingStatsUpdates = {};
let lastStatsFlush = Date.now();
let pendingStatsCount = 0;

/**
 * Increment cache statistics counter.
 * OPTIMIZED: Batches increments, writes every 100 calls or 5 minutes.
 *
 * Old: 1 KV write per increment (100 requests = 100 writes)
 * New: 1 KV write per 100 increments (100 requests = 1 write)
 */
async function incrementCacheStats(env, key) {
  if (!env.CACHE) {
    return;
  }

  try {
    // Accumulate in memory
    pendingStatsUpdates[key] = (pendingStatsUpdates[key] || 0) + 1;
    pendingStatsCount++;

    // Check if we should flush
    const timeSinceLastFlush = Date.now() - lastStatsFlush;
    const shouldFlush =
      pendingStatsCount >= STATS_FLUSH_THRESHOLD || timeSinceLastFlush >= STATS_FLUSH_INTERVAL_MS;

    if (!shouldFlush) {
      return; // Defer write
    }

    // Flush accumulated stats to KV
    const stats = (await env.CACHE.get("__stats__", { type: "json" })) || {
      llm_hits: 0,
      llm_misses: 0,
      transcription_hits: 0,
      transcription_misses: 0,
      command_hits: 0,
      // Template caching stats
      template_hits: 0,
      template_misses: 0,
      template_chat_hits: 0,
      template_chat_cache_hits: 0,
      // Dictation mode stats
      dictation_template_hits: 0,
      dictation_template_misses: 0,
      dictation_cleanup_hits: 0,
      dictation_cleanup_misses: 0,
      // Reading mode stats
      reading_template_hits: 0,
      reading_template_misses: 0,
      reading_summarize_hits: 0,
      reading_summarize_misses: 0,
      reading_vision_successes: 0,
      reading_vision_failures: 0,
      // Context sync stats
      context_syncs: 0,
    };

    // Apply all pending updates
    for (const [statKey, count] of Object.entries(pendingStatsUpdates)) {
      stats[statKey] = (stats[statKey] || 0) + count;
    }
    stats.last_updated = new Date().toISOString();
    stats.batch_write_count = (stats.batch_write_count || 0) + 1;

    await env.CACHE.put("__stats__", JSON.stringify(stats));

    // Reset pending
    pendingStatsUpdates = {};
    pendingStatsCount = 0;
    lastStatsFlush = Date.now();
  } catch (e) {
    console.error("Failed to update cache stats:", e);
  }
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

/**
 * Sanitize a string by removing/escaping control characters that break JSON.
 * This is critical for LLM responses which may contain unexpected characters.
 */
function sanitizeForJson(obj) {
  if (typeof obj === "string") {
    // Remove control characters (U+0000 through U+001F) except allowed ones
    // Allowed: \t (09), \n (0A), \r (0D)
    return obj.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForJson);
  }
  if (obj !== null && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeForJson(value);
    }
    return result;
  }
  return obj;
}

/**
 * Return a JSON response with CORS headers.
 * Sanitizes the response to remove control characters that break JSON parsing.
 */
function jsonResponse(data, corsHeaders, status = 200) {
  // Sanitize data to remove control characters that break JSON
  const sanitizedData = sanitizeForJson(data);

  return new Response(JSON.stringify(sanitizedData), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

/**
 * Generate a cache key for chat completions.
 */
function generateChatCacheKey(messages, model, temperature, tools) {
  const content = JSON.stringify({ messages, model, temperature, tools });
  // Simple hash for cache key
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `chat:${model}:${Math.abs(hash).toString(16)}`;
}

/**
 * Hash an ArrayBuffer using SHA-256.
 */
async function hashArrayBuffer(buffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash a string using SHA-256.
 */
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Convert base64 string to ArrayBuffer.
 */
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// =====================================================
// PROVIDER TRANSFORMERS (Anthropic, Gemini)
// =====================================================

/**
 * Transform OpenAI-style request to Anthropic format.
 */
function transformForAnthropic(payload) {
  const { messages, model, temperature, max_tokens, tools } = payload;

  // Extract system message
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  return {
    model,
    max_tokens: max_tokens || 4096,
    system: systemMessages.map((m) => m.content).join("\n") || undefined,
    messages: otherMessages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    ...(tools && {
      tools: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      })),
    }),
  };
}

/**
 * Transform Anthropic response to OpenAI format.
 */
function transformFromAnthropic(response) {
  const content = response.content?.[0];

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: content?.type === "text" ? content.text : null,
          tool_calls:
            content?.type === "tool_use"
              ? [
                  {
                    id: content.id,
                    type: "function",
                    function: {
                      name: content.name,
                      arguments: JSON.stringify(content.input),
                    },
                  },
                ]
              : undefined,
        },
        finish_reason: response.stop_reason === "end_turn" ? "stop" : response.stop_reason,
      },
    ],
    model: response.model,
    usage: {
      prompt_tokens: response.usage?.input_tokens,
      completion_tokens: response.usage?.output_tokens,
      total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    },
  };
}

/**
 * Transform OpenAI-style request to Gemini format.
 */
function transformForGemini(payload) {
  const { messages, temperature, max_tokens } = payload;

  return {
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature,
      maxOutputTokens: max_tokens,
    },
  };
}

/**
 * Transform Gemini response to OpenAI format.
 */
function transformFromGemini(response) {
  const candidate = response.candidates?.[0];
  const content = candidate?.content?.parts?.[0]?.text;

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content,
        },
        finish_reason: candidate?.finishReason === "STOP" ? "stop" : candidate?.finishReason,
      },
    ],
    model: "gemini",
    usage: {
      prompt_tokens: response.usageMetadata?.promptTokenCount,
      completion_tokens: response.usageMetadata?.candidatesTokenCount,
      total_tokens: response.usageMetadata?.totalTokenCount,
    },
  };
}

// =====================================================
// 📦 CONTEXT CACHING HANDLERS
// =====================================================

/**
 * Get domain context package.
 *
 * Provides pre-computed context for common domains (gmail.com, youtube.com, etc.)
 * This eliminates the need to build context from scratch each request.
 *
 * GET /api/context/domain?domain=gmail.com
 *
 * Response:
 *   {
 *     "domain": "gmail.com",
 *     "patterns": [...],
 *     "expectedTools": [...],
 *     "contextString": "### gmail.com Patterns\n..."
 *   }
 */
async function handleDomainContext(request, env, ctx, corsHeaders) {
  const url = new URL(request.url);
  const domain = url.searchParams.get("domain");
  const includeGotchas = url.searchParams.get("gotchas") !== "false";
  const includeTasks = url.searchParams.get("tasks") === "true";

  if (!domain) {
    return jsonResponse({ error: "domain parameter required" }, corsHeaders, 400);
  }

  const startTime = Date.now();
  const normalizedDomain = normalizeDomain(domain);

  // Check KV first for user-customized domain context
  if (env.CACHE) {
    const kvKey = `context:domain:${normalizedDomain}`;
    const cached = await env.CACHE.get(kvKey, { type: "json" });
    if (cached) {
      ctx.waitUntil(incrementCacheStats(env, "domain_context_kv_hits"));

      return jsonResponse(
        {
          ...cached,
          contextString: formatContextForLLM(cached, { includeGotchas, includeTasks }),
          cached: true,
          source: "kv",
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }
  }

  // Get from pre-defined packages (embedded in worker)
  const context = getDomainContext(domain);

  if (context) {
    ctx.waitUntil(incrementCacheStats(env, "domain_context_predefined_hits"));

    // Cache in KV for future requests (24 hour TTL)
    if (env.CACHE) {
      ctx.waitUntil(
        env.CACHE.put(`context:domain:${normalizedDomain}`, JSON.stringify(context), {
          expirationTtl: 86400,
        }),
      );
    }

    return jsonResponse(
      {
        ...context,
        contextString: formatContextForLLM(context, { includeGotchas, includeTasks }),
        cached: false,
        source: context.source || "predefined",
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  // No context found
  return jsonResponse(
    {
      domain: normalizedDomain,
      patterns: [],
      contextString: "",
      message: "No pre-defined context for this domain",
      availableDomains: getDomainStats().domains,
    },
    corsHeaders,
  );
}

/**
 * Get user context (patterns + learnings) from KV.
 *
 * This retrieves user-specific context that was synced from their local
 * ~/.centris/ directory by the backend.
 *
 * GET /api/context/user?user_id=default
 */
async function handleUserContext(request, env, ctx, corsHeaders) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id") || "default";

  if (!env.CACHE) {
    return jsonResponse({ error: "Cache not configured" }, corsHeaders, 500);
  }

  const startTime = Date.now();

  // Get user patterns
  const patternsKey = `user:${userId}:patterns`;
  const patterns = await env.CACHE.get(patternsKey, { type: "json" });

  // Get user learnings
  const learningsKey = `user:${userId}:learnings`;
  const learnings = await env.CACHE.get(learningsKey, { type: "json" });

  // Get user preferences
  const prefsKey = `user:${userId}:preferences`;
  const preferences = await env.CACHE.get(prefsKey, { type: "json" });

  // Build context string
  const contextParts = [];

  if (learnings?.recent_learnings?.length > 0) {
    contextParts.push("### Recent Learnings");
    contextParts.push(
      learnings.recent_learnings
        .slice(0, 7)
        .map((l) => `- ${l}`)
        .join("\n"),
    );
  }

  if (learnings?.patterns?.length > 0) {
    contextParts.push("### Learned Patterns");
    contextParts.push(
      learnings.patterns
        .slice(0, 5)
        .map((p) => `- ${p}`)
        .join("\n"),
    );
  }

  const contextString = contextParts.join("\n\n");

  return jsonResponse(
    {
      user_id: userId,
      patterns: patterns || null,
      learnings: learnings || null,
      preferences: preferences || null,
      contextString,
      token_estimate: Math.ceil(contextString.length / 4),
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION WRITE OPTIMIZATION: Skip unchanged sessions
// ═══════════════════════════════════════════════════════════════════════════════
// Sessions typically update frequently during a conversation. Instead of writing
// on every update, we check if the session has actually changed significantly.
//
// Significant changes (trigger write):
// - New session (doesn't exist)
// - Task index changed
// - Task queue changed
// - Conversation history grew by 2+ messages
// - Learnings added
//
// Non-significant changes (skip write):
// - Same state (duplicate request)
// - Only timestamp changed
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get or update session context.
 *
 * Sessions store active task state, conversation history, and session-specific
 * learnings. This enables task resumption and multi-turn conversations.
 *
 * GET /api/context/session?session_id=xxx - Get session
 * POST /api/context/session - Update session
 *
 * KV WRITE OPTIMIZATION: Only writes on significant changes.
 */
async function handleSessionContext(request, env, ctx, corsHeaders) {
  if (!env.CACHE) {
    return jsonResponse({ error: "Cache not configured" }, corsHeaders, 500);
  }

  const startTime = Date.now();

  if (request.method === "GET") {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      return jsonResponse({ error: "session_id parameter required" }, corsHeaders, 400);
    }

    const kvKey = `session:${sessionId}`;
    const session = await env.CACHE.get(kvKey, { type: "json" });

    if (!session) {
      return jsonResponse(
        {
          session_id: sessionId,
          exists: false,
          message: "Session not found or expired",
        },
        corsHeaders,
      );
    }

    return jsonResponse(
      {
        ...session,
        exists: true,
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  if (request.method === "POST") {
    const body = await request.json();
    const {
      session_id,
      user_id = "default",
      current_url,
      current_domain,
      active_task_queue_id,
      current_task_index,
      conversation_history,
      session_learnings,
      force_write = false, // Allow forcing a write if needed
    } = body;

    if (!session_id) {
      return jsonResponse({ error: "session_id required" }, corsHeaders, 400);
    }

    const kvKey = `session:${session_id}`;

    // Check existing session to detect significant changes
    const existingSession = await env.CACHE.get(kvKey, { type: "json" });

    const newSession = {
      session_id,
      user_id,
      current_url,
      current_domain,
      active_task_queue_id,
      current_task_index: current_task_index || 0,
      conversation_history: conversation_history || [],
      session_learnings: session_learnings || [],
      updated_at: new Date().toISOString(),
      write_count: (existingSession?.write_count || 0) + 1,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SKIP WRITE IF NO SIGNIFICANT CHANGES
    // ═══════════════════════════════════════════════════════════════════════════
    let shouldWrite = force_write;
    let skipReason = null;

    if (!existingSession) {
      // New session - always write
      shouldWrite = true;
    } else if (!shouldWrite) {
      // Check for significant changes
      const taskChanged =
        existingSession.active_task_queue_id !== active_task_queue_id ||
        existingSession.current_task_index !== (current_task_index || 0);
      const historyGrew =
        (conversation_history?.length || 0) - (existingSession.conversation_history?.length || 0) >=
        2;
      const learningsAdded =
        (session_learnings?.length || 0) > (existingSession.session_learnings?.length || 0);
      const urlChanged = existingSession.current_url !== current_url;

      shouldWrite = taskChanged || historyGrew || learningsAdded || urlChanged;

      if (!shouldWrite) {
        skipReason = "no_significant_changes";
      }
    }

    if (shouldWrite) {
      await env.CACHE.put(kvKey, JSON.stringify(newSession), {
        expirationTtl: 900, // 15 minutes
      });
    }

    return jsonResponse(
      {
        session_id,
        updated: shouldWrite,
        skipped: !shouldWrite,
        skip_reason: skipReason,
        write_count: newSession.write_count,
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
}

/**
 * Sync user context from backend to Supabase.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * KV WRITE OPTIMIZATION: 0 KV writes! Writes go to Supabase directly.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Called by the backend to sync local ~/.centris/ files to Supabase.
 * Data will sync to KV on next login via syncFromSupabase().
 *
 * OLD approach: Write to 3 separate KV keys (3 writes per sync!)
 * NEW approach: Write to Supabase, KV syncs on login (0 writes here)
 *
 * POST /api/context/sync
 * {
 *   "user_id": "default",
 *   "patterns_by_domain": {...},
 *   "recent_learnings": [...],
 *   "consolidated_patterns": [...]
 * }
 */
async function handleContextSync(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    user_id = "default",
    patterns_by_domain,
    recent_learnings,
    consolidated_patterns,
    preferences,
  } = body;

  const synced = {};
  const supabase_writes = { patterns: 0, learnings: 0 };

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE PATTERNS TO SUPABASE (not KV!)
  // ═══════════════════════════════════════════════════════════════════════════
  if (patterns_by_domain && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    // Convert patterns_by_domain to individual pattern records
    for (const [domain, patterns] of Object.entries(patterns_by_domain)) {
      for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
        try {
          const patternKey = pattern.key || `${domain}:${pattern.type || "selector"}`;
          await syncToSupabase(env, user_id, {
            patterns: [
              {
                key: patternKey,
                type: pattern.type || "selector",
                domain: domain,
                data: pattern,
                confidence: pattern.confidence || 1.0,
                use_count: pattern.use_count || 1,
              },
            ],
          });
          supabase_writes.patterns++;
        } catch (e) {
          console.error(`Pattern sync error for ${domain}:`, e);
        }
      }
    }
    synced.patterns = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE LEARNINGS TO SUPABASE (not KV!)
  // ═══════════════════════════════════════════════════════════════════════════
  if ((recent_learnings || consolidated_patterns) && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    const learnings = [];

    // Convert recent_learnings
    if (recent_learnings && Array.isArray(recent_learnings)) {
      learnings.push(
        ...recent_learnings.map((l) => ({
          type: l.type || "discovery",
          domain: l.domain || null,
          content: l.content || l.text || JSON.stringify(l),
          data: l,
          importance: l.importance || "medium",
        })),
      );
    }

    // Convert consolidated_patterns to learnings
    if (consolidated_patterns && Array.isArray(consolidated_patterns)) {
      learnings.push(
        ...consolidated_patterns.map((p) => ({
          type: "consolidated_pattern",
          domain: p.domain || null,
          content: p.description || p.pattern || JSON.stringify(p),
          data: p,
          importance: "high",
        })),
      );
    }

    if (learnings.length > 0) {
      await syncToSupabase(env, user_id, { learnings });
      supabase_writes.learnings = learnings.length;
    }
    synced.learnings = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PREFERENCES: Store in KV only (small, rarely changes)
  // This is the only KV write - preferences are small and change rarely
  // ═══════════════════════════════════════════════════════════════════════════
  if (preferences && env.CACHE) {
    const prefsKey = `user:${user_id}:preferences`;
    await env.CACHE.put(
      prefsKey,
      JSON.stringify({
        preferences,
        synced_at: new Date().toISOString(),
      }),
      { expirationTtl: 86400 },
    ); // 24 hours (longer TTL since rarely changes)
    synced.preferences = true;
  }

  return jsonResponse(
    {
      user_id,
      synced,
      kv_writes: synced.preferences ? 1 : 0, // Only preferences go to KV
      supabase_writes,
      optimization: "direct_to_supabase",
      note: "Patterns/learnings sync to KV on next login via /api/sync/pull",
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Get combined context (domain + user + session) in one call.
 *
 * This is the KEY optimization - instead of making 3 separate calls to get
 * domain patterns, user learnings, and session state, we get everything
 * in a single request.
 *
 * POST /api/context/combined
 * {
 *   "domain": "gmail.com",
 *   "user_id": "default",
 *   "session_id": "sess_123"
 * }
 *
 * Response:
 * {
 *   "contextString": "### gmail.com Patterns\n...\n### Recent Learnings\n...",
 *   "tokenEstimate": 450,
 *   "components": { "domain": true, "user": true, "session": false }
 * }
 */
async function handleCombinedContext(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    domain,
    user_id = "default",
    session_id,
    include_gotchas = true,
    max_patterns = 7,
    max_learnings = 5,
  } = body;

  const contextParts = [];
  const components = { domain: false, user: false, session: false };

  // 1. Domain context (from pre-defined packages)
  if (domain) {
    const domainContext = getDomainContext(domain);
    if (domainContext?.patterns?.length > 0) {
      const domainName = domainContext.domain || normalizeDomain(domain);
      contextParts.push(`### ${domainName} Patterns`);
      contextParts.push(
        domainContext.patterns
          .slice(0, max_patterns)
          .map((p) => `- ${p}`)
          .join("\n"),
      );

      if (include_gotchas && domainContext.gotchas?.length > 0) {
        contextParts.push("### Watch Out For");
        contextParts.push(
          domainContext.gotchas
            .slice(0, 3)
            .map((g) => `⚠️ ${g}`)
            .join("\n"),
        );
      }

      components.domain = true;
    }
  }

  // 2. User context (from KV)
  if (env.CACHE) {
    // User learnings
    const learnings = await env.CACHE.get(`user:${user_id}:learnings`, { type: "json" });
    if (learnings?.recent_learnings?.length > 0) {
      contextParts.push("### Recent Learnings");
      contextParts.push(
        learnings.recent_learnings
          .slice(0, max_learnings)
          .map((l) => `- ${l}`)
          .join("\n"),
      );
      components.user = true;
    }

    // Domain-specific user patterns
    if (domain) {
      const patterns = await env.CACHE.get(`user:${user_id}:patterns`, { type: "json" });
      const normalizedDomain = normalizeDomain(domain);
      const domainPatterns = patterns?.patterns_by_domain?.[normalizedDomain] || [];
      if (domainPatterns.length > 0) {
        contextParts.push(`### Learned ${normalizedDomain} Patterns`);
        contextParts.push(
          domainPatterns
            .slice(0, 3)
            .map((p) => `- ${p}`)
            .join("\n"),
        );
        components.user = true;
      }
    }

    // 3. Session context (from KV)
    if (session_id) {
      const session = await env.CACHE.get(`session:${session_id}`, { type: "json" });
      if (session) {
        if (session.current_url) {
          contextParts.push(`Current URL: ${session.current_url}`);
        }
        if (session.session_learnings?.length > 0) {
          contextParts.push("### Session Context");
          contextParts.push(
            session.session_learnings
              .slice(-3)
              .map((l) => `- ${l}`)
              .join("\n"),
          );
        }
        if (session.active_task_queue_id) {
          contextParts.push(
            `Active task: ${session.active_task_queue_id} (step ${session.current_task_index || 0})`,
          );
        }
        components.session = true;
      }
    }
  }

  const contextString = contextParts.join("\n\n");
  const tokenEstimate = Math.ceil(contextString.length / 4);

  ctx.waitUntil(incrementCacheStats(env, "combined_context_hits"));

  return jsonResponse(
    {
      contextString,
      tokenEstimate,
      components,
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Chat with full context (template + domain + user in one call).
 *
 * This combines template caching with context caching for maximum optimization:
 * 1. Load template from KV (~3ms)
 * 2. Load domain context from pre-defined packages (~0ms)
 * 3. Load user context from KV (~3ms)
 * 4. Inject all into LLM call
 *
 * Result: ~10ms context assembly vs ~100ms+ traditional approach.
 *
 * POST /api/chat/full-context
 * {
 *   "template_name": "default",
 *   "user_message": "Go to Gmail and read my emails",
 *   "domain": "gmail.com",
 *   "user_id": "default",
 *   "session_id": "sess_123",
 *   "conversation_history": [...],
 *   "temperature": 0.7
 * }
 */
async function handleChatWithFullContext(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    template_id,
    template_name = "default",
    user_message,
    conversation_history = [],
    domain,
    user_id = "default",
    session_id,
    temperature = 0.7,
    max_tokens,
    tool_choice,
    provider: providerOverride,
    model: modelOverride,
  } = body;

  if (!user_message) {
    return jsonResponse({ error: "user_message required" }, corsHeaders, 400);
  }

  // 1. Load template
  let resolvedTemplateId = template_id;
  if (!resolvedTemplateId && env.CACHE) {
    resolvedTemplateId = await env.CACHE.get(`template:${template_name}:latest`);
  }

  const template = resolvedTemplateId
    ? await env.CACHE?.get(`template:${resolvedTemplateId}`, { type: "json" })
    : null;

  if (!template) {
    return jsonResponse(
      {
        error: "Template not found. Initialize via /api/template/init first.",
      },
      corsHeaders,
      404,
    );
  }

  const templateLoadMs = Date.now() - startTime;

  // 2. Build context string
  const contextParts = [];
  const contextComponents = { domain: false, user: false, session: false };

  // Domain context
  if (domain) {
    const domainContext = getDomainContext(domain);
    if (domainContext?.patterns?.length > 0) {
      const domainName = domainContext.domain || normalizeDomain(domain);
      contextParts.push(`### ${domainName} Patterns`);
      contextParts.push(
        domainContext.patterns
          .slice(0, 5)
          .map((p) => `- ${p}`)
          .join("\n"),
      );

      if (domainContext.gotchas?.length > 0) {
        contextParts.push("### Watch Out");
        contextParts.push(
          domainContext.gotchas
            .slice(0, 2)
            .map((g) => `⚠️ ${g}`)
            .join("\n"),
        );
      }
      contextComponents.domain = true;
    }
  }

  // User learnings
  if (env.CACHE) {
    const learnings = await env.CACHE.get(`user:${user_id}:learnings`, { type: "json" });
    if (learnings?.recent_learnings?.length > 0) {
      contextParts.push("### Learnings");
      contextParts.push(
        learnings.recent_learnings
          .slice(0, 4)
          .map((l) => `- ${l}`)
          .join("\n"),
      );
      contextComponents.user = true;
    }
  }

  const contextString = contextParts.join("\n\n");
  const contextLoadMs = Date.now() - startTime - templateLoadMs;

  // 3. Build messages array
  const messages = [{ role: "system", content: template.system_prompt }];

  // Inject context as system message extension
  if (contextString) {
    messages.push({
      role: "system",
      content: `## Context:\n${contextString}`,
    });
  }

  // Add conversation history
  messages.push(...conversation_history);

  // Add user message
  messages.push({ role: "user", content: user_message });

  // 4. Check response cache
  const provider = providerOverride || template.provider || "deepseek";
  const model = modelOverride || template.model || "deepseek-chat";
  const cacheKey = generateChatCacheKey(messages, model, temperature, template.tools);

  const aggressiveCaching = env.ENABLE_AGGRESSIVE_CACHING === "true";
  const shouldCache = env.ENABLE_LLM_CACHING === "true" && env.CACHE;
  const checkCache = shouldCache && (temperature === 0 || aggressiveCaching);

  if (checkCache) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      ctx.waitUntil(incrementCacheStats(env, "full_context_cache_hits"));

      const cachedResponse = JSON.parse(cached);
      return jsonResponse(
        {
          ...cachedResponse,
          cached: true,
          template_used: resolvedTemplateId,
          context_components: contextComponents,
          timing: {
            template_load_ms: templateLoadMs,
            context_load_ms: contextLoadMs,
            total_ms: Date.now() - startTime,
          },
        },
        corsHeaders,
      );
    }
  }

  // 5. Call LLM
  const llmStart = Date.now();
  let response;

  if (provider === "workers-ai") {
    response = await callWorkersAI(env, messages, model);
  } else {
    response = await callExternalProvider(
      provider,
      messages,
      model,
      temperature,
      max_tokens,
      template.tools,
      tool_choice,
      env,
    );
  }

  const llmMs = Date.now() - llmStart;

  // 6. Cache response
  if (shouldCache && response.choices?.[0]?.message) {
    let ttl = 0;
    if (temperature === 0) {
      ttl = parseInt(env.LLM_CACHE_TTL || "86400", 10);
    } else if (aggressiveCaching) {
      if (temperature <= 0.3) {
        ttl = 14400;
      } else if (temperature <= 0.7) {
        ttl = 3600;
      } else {
        ttl = 900;
      }
    }

    if (ttl > 0) {
      ctx.waitUntil(env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: ttl }));
    }
  }

  // 7. Calculate optimization stats
  const templateTokens = template.token_estimate || 6500;
  const contextTokens = Math.ceil(contextString.length / 4);
  const userTokens = Math.ceil(user_message.length / 4);
  const historyTokens = Math.ceil(JSON.stringify(conversation_history).length / 4);
  const totalSent = userTokens + historyTokens;
  const totalSaved = templateTokens + contextTokens;

  ctx.waitUntil(incrementCacheStats(env, "full_context_chat_hits"));

  return jsonResponse(
    {
      ...response,
      cached: false,
      template_used: resolvedTemplateId,
      context_components: contextComponents,
      optimization: {
        template_tokens_saved: templateTokens,
        context_tokens_cached: contextTokens,
        tokens_sent: totalSent,
        tokens_saved: totalSaved,
        reduction_percent: Math.round((totalSaved / (totalSaved + totalSent)) * 100),
      },
      timing: {
        template_load_ms: templateLoadMs,
        context_load_ms: contextLoadMs,
        llm_call_ms: llmMs,
        total_ms: Date.now() - startTime,
      },
      provider,
      model,
    },
    corsHeaders,
  );
}

// =====================================================
// VECTORIZE: SEMANTIC PATTERN SEARCH
// =====================================================
// Enables finding similar commands/patterns by meaning
// Used for:
//   1. Instant execution of recognized patterns during speech
//   2. Finding relevant learnings for current task
//   3. Action cache lookup by similarity (not just exact match)

/**
 * Search for similar patterns using Vectorize.
 *
 * POST /api/patterns/search
 * {
 *   "query": "go to gmail and read emails",
 *   "top_k": 5,
 *   "min_score": 0.7,
 *   "filter": { "domain": "gmail.com" }  // optional
 * }
 *
 * Returns patterns that semantically match the query, along with
 * their stored tool calls and metadata for instant execution.
 */
async function handleCommandPatternSearch(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const { query, top_k = 5, min_score = 0.7, filter = {} } = body;

  if (!query) {
    return jsonResponse({ error: "query required" }, corsHeaders, 400);
  }

  // Check if Vectorize is configured (uses PATTERNS binding from wrangler.toml)
  if (!env.PATTERNS) {
    // Fallback to KV-based exact match search
    return await handlePatternSearchFallback(query, top_k, env, corsHeaders, startTime);
  }

  try {
    // Generate embedding for query using Workers AI
    const embedding = await generateEmbedding(env, query);

    // Search Vectorize using PATTERNS binding
    const results = await env.PATTERNS.query(embedding, {
      topK: top_k,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      returnMetadata: true,
      returnValues: false,
    });

    // Filter by minimum score and enrich with metadata from KV
    const matches = [];
    for (const match of results.matches) {
      if (match.score >= min_score) {
        // Get full pattern data from KV
        // match.id already has the full pattern ID (e.g., "p:abc123...")
        const patternData = await env.CACHE?.get(match.id, { type: "json" });
        matches.push({
          id: match.id,
          score: match.score,
          pattern: patternData?.pattern || match.metadata?.pattern,
          tool_calls: patternData?.tool_calls || [],
          domain: patternData?.domain || match.metadata?.domain,
          success_count: patternData?.success_count || 0,
          last_used: patternData?.last_used,
        });
      }
    }

    ctx.waitUntil(incrementCacheStats(env, "pattern_searches"));

    return jsonResponse(
      {
        query,
        matches,
        count: matches.length,
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  } catch (error) {
    console.error("Vectorize search error:", error);
    // Fallback to KV search
    return await handlePatternSearchFallback(query, top_k, env, corsHeaders, startTime);
  }
}

/**
 * Fallback pattern search using KV (when Vectorize not configured).
 * Uses simple prefix/substring matching.
 */
async function handlePatternSearchFallback(query, top_k, env, corsHeaders, startTime) {
  if (!env.CACHE) {
    return jsonResponse(
      {
        query,
        matches: [],
        count: 0,
        fallback: true,
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  // Try to find cached patterns by common command prefixes
  const queryLower = query.toLowerCase();
  const matches = [];

  // Common pattern keys to check
  const patternKeys = [
    "pattern:nav:gmail",
    "pattern:nav:youtube",
    "pattern:nav:google",
    "pattern:click:compose",
    "pattern:click:send",
    "pattern:read:email",
    "pattern:scroll:down",
  ];

  for (const key of patternKeys) {
    const pattern = await env.CACHE.get(key, { type: "json" });
    if (pattern) {
      // Simple substring match
      const patternLower = (pattern.pattern || "").toLowerCase();
      if (
        patternLower.includes(queryLower.split(" ")[0]) ||
        queryLower.includes(patternLower.split(" ")[0])
      ) {
        matches.push({
          id: key,
          score: 0.7, // Approximate score
          pattern: pattern.pattern,
          tool_calls: pattern.tool_calls || [],
          domain: pattern.domain,
          success_count: pattern.success_count || 0,
        });
      }
    }

    if (matches.length >= top_k) {
      break;
    }
  }

  return jsonResponse(
    {
      query,
      matches,
      count: matches.length,
      fallback: true,
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Index a new pattern after successful execution.
 *
 * POST /api/patterns/index
 * {
 *   "pattern": "go to gmail and read first email",
 *   "tool_calls": [...],
 *   "domain": "gmail.com",
 *   "success": true,
 *   "user_id": "default",
 *   "browser_context": {...},  // Optional: page state when executed
 *   "execution_time_ms": 1500  // Optional: how long execution took
 * }
 *
 * DATA STRUCTURE:
 * ===============
 * 1. PATTERN RECORD (KV: p:{hash}) - For instant execution lookup
 *    {
 *      pattern: "go to gmail",
 *      tool_calls: [{name: "navigate_browser", arguments: {...}}],
 *      domain: "gmail.com",
 *      success_count: 47,
 *      execution_count: 50,  // Total attempts (including failures)
 *      first_seen: "2026-01-10T...",
 *      last_used: "2026-01-12T...",
 *      avg_execution_time_ms: 1200,
 *    }
 *
 * 2. EXECUTION LOG (KV: exec:{timestamp}:{hash}) - Individual traces for training
 *    {
 *      pattern: "go to gmail",
 *      tool_calls: [...],
 *      success: true,
 *      execution_time_ms: 1500,
 *      browser_context: {...},  // Page state at execution
 *      user_id: "user123",
 *      timestamp: "2026-01-12T...",
 *    }
 *
 * 3. VECTORIZE INDEX - For semantic similarity search
 *    {id: "p:{hash}", embedding: [768 dims], metadata: {pattern, domain}}
 *
 * This enables:
 * - Instant execution via pattern lookup
 * - Full execution history for LLM training
 * - Analytics on success rates per pattern
 */

/**
 * Generalize a pattern by replacing specific values with placeholders.
 * This enables broader pattern matching:
 *   "forward email to john" → "forward email to {name}"
 *   "go to amazon.com" → "go to {url}"
 *
 * @param {string} text - Raw pattern text
 * @returns {{generalized: string, extractions: object}} - Generalized pattern + extracted values
 */
/**
 * Infer verification method from tool call type.
 * Used when patterns don't have explicit verification config stored.
 * This enables the verification flow even for legacy learned patterns.
 *
 * @param {object} toolCall - Tool call object with name and arguments
 * @returns {object|null} - Verification config or null if no inference possible
 */
function inferVerificationFromToolCall(toolCall) {
  if (!toolCall?.name) {
    return null;
  }

  switch (toolCall.name) {
    case "navigate_browser":
    case "navigate":
      // For navigation, check that URL contains the target domain
      const url = toolCall.arguments?.url || "";
      try {
        const domain = new URL(url).hostname;
        return {
          method: "url_check",
          expected: domain,
          timeout_ms: 5000,
        };
      } catch {
        return null;
      }

    case "scroll_page":
    case "scroll":
      return {
        method: "state_change",
        expected: "scroll_position_changed",
        timeout_ms: 1000,
      };

    case "click_node":
    case "click":
      return {
        method: "element_present",
        expected: toolCall.arguments?.selector || toolCall.arguments?.text,
        timeout_ms: 3000,
      };

    case "type_text":
    case "type":
      return {
        method: "state_change",
        expected: "text_changed",
        timeout_ms: 2000,
      };

    case "press_key":
    case "press_keys":
    case "keyboard":
      return {
        method: "none", // Key presses are hard to verify generically
        timeout_ms: 500,
      };

    case "launch_app":
    case "open_app":
      return {
        method: "state_change",
        expected: "app_launched",
        timeout_ms: 5000,
      };

    default:
      // Default verification - just check for no error
      return {
        method: "no_error",
        timeout_ms: 3000,
      };
  }
}

function generalizePattern(text) {
  let generalized = text.toLowerCase().trim();
  const extractions = {};

  // 1. Replace email addresses with {email}
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = generalized.match(emailRegex);
  if (emails) {
    extractions.emails = emails;
    generalized = generalized.replace(emailRegex, "{email}");
  }

  // 2. Replace URLs with {url} (but NOT domain keywords like "gmail", "amazon")
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const urls = generalized.match(urlRegex);
  if (urls) {
    extractions.urls = urls;
    generalized = generalized.replace(urlRegex, "{url}");
  }

  // 3. Replace names after "to ", "from ", "for ", "with " (common patterns)
  //    But keep domain words like "gmail", "amazon", "google"
  const domainWords = new Set([
    "gmail",
    "amazon",
    "google",
    "facebook",
    "twitter",
    "linkedin",
    "youtube",
    "outlook",
    "slack",
    "discord",
  ]);
  const namePattern = /\b(to|from|for|with|email|message|send)\s+([a-z]+)\b/gi;
  generalized = generalized.replace(namePattern, (match, preposition, name) => {
    // Don't replace domain keywords
    if (domainWords.has(name.toLowerCase())) {
      return match;
    }
    // Don't replace common words
    const commonWords = [
      "the",
      "a",
      "an",
      "my",
      "your",
      "this",
      "that",
      "first",
      "last",
      "new",
      "all",
    ];
    if (commonWords.includes(name.toLowerCase())) {
      return match;
    }
    extractions.names = extractions.names || [];
    extractions.names.push(name);
    return `${preposition} {name}`;
  });

  // 4. Replace dollar amounts with {amount}
  const moneyRegex = /\$[\d,]+(?:\.\d{2})?/g;
  const amounts = generalized.match(moneyRegex);
  if (amounts) {
    extractions.amounts = amounts;
    generalized = generalized.replace(moneyRegex, "{amount}");
  }

  // 5. Replace dates with {date} (simple patterns)
  const dateRegex = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
  const dates = generalized.match(dateRegex);
  if (dates) {
    extractions.dates = dates;
    generalized = generalized.replace(dateRegex, "{date}");
  }

  return { generalized, extractions };
}

async function handlePatternIndex(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    pattern,
    tool_calls = [],
    domain = "",
    success = true,
    user_id = "default",
    browser_context = null,
    execution_time_ms = 0,
  } = body;

  if (!pattern) {
    return jsonResponse({ error: "pattern required" }, corsHeaders, 400);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERALIZE PATTERN: "forward email to john" → "forward email to {name}"
  // This enables broader matching across similar commands
  // ═══════════════════════════════════════════════════════════════════════════
  const { generalized, extractions } = generalizePattern(pattern);

  // Generate pattern ID from GENERALIZED pattern (so variants share same record)
  const hash = await hashString(generalized);
  const patternId = `p:${hash.slice(0, 56)}`;

  // Generate unique execution ID for this specific execution trace
  const timestamp = Date.now();
  const execId = `exec:${timestamp}:${hash.slice(0, 20)}`;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Log individual execution (NEVER deduplicated - full history!)
  // This is the key training data - every execution is valuable
  // Stores BOTH original pattern AND generalized for training purposes
  // ═══════════════════════════════════════════════════════════════════════════
  const executionLog = {
    pattern, // Original: "forward email to john"
    generalized_pattern: generalized, // Generalized: "forward email to {name}"
    extractions, // Extracted values: {names: ["john"]}
    tool_calls,
    domain,
    user_id,
    success,
    execution_time_ms,
    browser_context: browser_context
      ? {
          url: browser_context.url,
          title: browser_context.title,
        }
      : null,
    timestamp: new Date().toISOString(),
    pattern_id: patternId,
  };

  if (env.CACHE) {
    // Store execution log with 90-day TTL (longer for training data)
    await env.CACHE.put(execId, JSON.stringify(executionLog), {
      expirationTtl: 7776000, // 90 days
    });

    // Track execution in a daily log for efficient export
    const today = new Date().toISOString().split("T")[0];
    const dailyKey = `daily:${today}`;
    const daily = (await env.CACHE.get(dailyKey, { type: "json" })) || { executions: [] };
    daily.executions.push(execId);
    await env.CACHE.put(dailyKey, JSON.stringify(daily), {
      expirationTtl: 7776000, // 90 days
    });
  }

  ctx.waitUntil(incrementCacheStats(env, "executions_logged"));

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Update canonical pattern record (for instant execution)
  // This IS deduplicated - one record per GENERALIZED pattern
  // "forward email to john" and "forward email to alice" share same record!
  // ═══════════════════════════════════════════════════════════════════════════
  const existing = await env.CACHE?.get(patternId, { type: "json" });

  const patternData = {
    pattern: generalized, // Store GENERALIZED pattern as canonical
    example_original: pattern, // Keep one original example for debugging
    tool_calls: success ? tool_calls : existing?.tool_calls || tool_calls,
    domain,
    // Execution statistics
    execution_count: (existing?.execution_count || 0) + 1,
    success_count: success ? (existing?.success_count || 0) + 1 : existing?.success_count || 0,
    failure_count: success ? existing?.failure_count || 0 : (existing?.failure_count || 0) + 1,
    success_rate: success
      ? ((existing?.success_count || 0) + 1) / ((existing?.execution_count || 0) + 1)
      : (existing?.success_count || 0) / ((existing?.execution_count || 0) + 1),
    // Timing
    first_seen: existing?.first_seen || new Date().toISOString(),
    last_used: new Date().toISOString(),
    last_success: success ? new Date().toISOString() : existing?.last_success,
    // Performance tracking
    avg_execution_time_ms: existing?.avg_execution_time_ms
      ? existing.avg_execution_time_ms * 0.9 + execution_time_ms * 0.1
      : execution_time_ms,
    // User tracking
    user_ids: [...new Set([...(existing?.user_ids || []), user_id])].slice(-10),
  };

  if (env.CACHE) {
    await env.CACHE.put(patternId, JSON.stringify(patternData), {
      expirationTtl: 2592000, // 30 days
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Index GENERALIZED pattern in Vectorize for semantic search
  // Embedding uses "forward email to {name}" NOT "forward email to john"
  // This enables matching across variants: "send to alice" matches "send to {name}"
  // ═══════════════════════════════════════════════════════════════════════════
  if (success && env.PATTERNS) {
    try {
      const embedding = await generateEmbedding(env, generalized); // Use GENERALIZED
      await env.PATTERNS.upsert([
        {
          id: patternId,
          values: embedding,
          metadata: {
            pattern: generalized.substring(0, 100), // Store generalized in metadata
            domain,
            type: "simple_pattern",
            success_count: patternData.success_count,
          },
        },
      ]);
    } catch (error) {
      console.error("Vectorize index error:", error);
    }
  }

  ctx.waitUntil(incrementCacheStats(env, "patterns_indexed"));
  ctx.waitUntil(updatePatternStats(env, patternId, domain));

  // Show if pattern was generalized in response
  const wasGeneralized = generalized !== pattern.toLowerCase().trim();

  return jsonResponse(
    {
      indexed: true,
      pattern_id: patternId,
      execution_id: execId,
      original_pattern: pattern,
      generalized_pattern: wasGeneralized ? generalized : undefined, // Only if different
      extractions: Object.keys(extractions).length > 0 ? extractions : undefined,
      success_count: patternData.success_count,
      execution_count: patternData.execution_count,
      success_rate: Math.round(patternData.success_rate * 100) + "%",
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Get instant response for a recognized pattern.
 *
 * POST /api/patterns/instant
 * {
 *   "partial_transcript": "go to gmail",
 *   "min_confidence": 0.8
 * }
 *
 * This is called DURING SPEECH when progressive intent detects a pattern.
 * If we have a high-confidence match, return the tool calls immediately
 * so execution can start while the user is still talking!
 *
 * Returns:
 * - If match found: { instant: true, tool_calls: [...], confidence: 0.9 }
 * - If no match: { instant: false }
 */
/**
 * Handle instant pattern lookup - THE CORE OF SELF-LEARNING!
 *
 * FLOW (SIMPLE):
 *   1. User speaks → partial transcript arrives
 *   2. Search Vectorize for LEARNED patterns (from past executions)
 *   3. If found with high confidence → INSTANT EXECUTION (no LLM needed!)
 *   4. If not found → return false, backend will use LLM to plan
 *   5. After LLM execution → backend calls /api/patterns/index to LEARN
 *   6. Next time → Vectorize finds it → INSTANT!
 *
 * This creates a self-improving system where every successful execution
 * makes future similar commands instant.
 */
async function handlePatternInstant(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const { partial_transcript, min_confidence = 0.85, domain = "" } = body;

  if (!partial_transcript || partial_transcript.length < 5) {
    return jsonResponse({ instant: false, reason: "Transcript too short" }, corsHeaders);
  }

  const normalizedTranscript = partial_transcript.toLowerCase().trim();

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERALIZE QUERY: "forward email to john" → "forward email to {name}"
  // This matches against stored generalized patterns!
  // ═══════════════════════════════════════════════════════════════════════════
  const { generalized: generalizedQuery, extractions: queryExtractions } =
    generalizePattern(partial_transcript);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: VECTORIZE FIRST - Search LEARNED patterns
  // Uses GENERALIZED query to match against generalized stored patterns
  // "forward email to alice" → "forward email to {name}" → matches!
  // ═══════════════════════════════════════════════════════════════════════════
  if (env.PATTERNS && env.AI && partial_transcript.length >= 6) {
    try {
      const embedding = await generateEmbedding(env, generalizedQuery); // Use GENERALIZED
      const results = await env.PATTERNS.query(embedding, {
        topK: 3, // Get top 3 for better matching
        returnMetadata: true,
      });

      // Find best match above confidence threshold
      for (const match of results.matches) {
        if (match.score >= min_confidence) {
          // ═══════════════════════════════════════════════════════════════════════
          // CHECK KNOWN FAILURES: Skip patterns that have failed too many times
          // This prevents instant execution of patterns in penalty period
          // ═══════════════════════════════════════════════════════════════════════
          const failureCheck = await checkKnownFailures(env, match.id);
          if (failureCheck.skip) {
            console.log(`⚠️ SKIPPING PENALIZED PATTERN: "${match.id}" - ${failureCheck.reason}`);
            ctx.waitUntil(incrementCacheStats(env, "instant_pattern_skipped_penalty"));
            continue; // Try next match
          }

          // Fetch full pattern data from KV
          const patternData = await env.CACHE?.get(match.id, { type: "json" });

          if (patternData?.tool_calls?.length > 0) {
            // Check pattern-specific confidence score (may have been adjusted)
            const effectiveConfidence = Math.min(
              match.score,
              patternData.confidence_score || match.score,
            );

            if (effectiveConfidence < min_confidence) {
              console.log(
                `⚠️ CONFIDENCE TOO LOW: "${match.id}" (${Math.round(effectiveConfidence * 100)}% < ${Math.round(min_confidence * 100)}%)`,
              );
              continue; // Try next match
            }

            ctx.waitUntil(incrementCacheStats(env, "instant_pattern_vectorize_hits"));

            console.log(
              `⚡ VECTORIZE HIT: "${normalizedTranscript}" → "${patternData.pattern}" (${Math.round(effectiveConfidence * 100)}%)`,
            );

            // Infer verification from tool call if not stored
            let verification = patternData.verification;
            if (!verification && patternData.tool_calls?.[0]) {
              const toolCall = patternData.tool_calls[0];
              verification = inferVerificationFromToolCall(toolCall);
            }

            return jsonResponse(
              {
                instant: true,
                pattern: patternData.pattern, // Generalized pattern: "forward email to {name}"
                pattern_key: match.id, // For verification callback
                original_query: partial_transcript, // What user said: "forward email to alice"
                extractions: queryExtractions, // Extracted: {names: ["alice"]}
                tool_calls: patternData.tool_calls,
                verification, // Verification config for caller
                confidence: effectiveConfidence,
                source: "vectorize_learned",
                execution_count: patternData.execution_count || 1,
                success_rate:
                  patternData.success_count && patternData.execution_count
                    ? Math.round((patternData.success_count / patternData.execution_count) * 100) +
                      "%"
                    : "N/A",
                latency_ms: Date.now() - startTime,
              },
              corsHeaders,
            );
          }
        }
      }
    } catch (error) {
      console.error("Vectorize search error (will try bootstrap):", error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: BOOTSTRAP FALLBACK - Only for cold start before system has learned
  // These patterns kickstart the system but should eventually be replaced by
  // learned patterns in Vectorize. Once Vectorize has enough data, these rarely
  // get used.
  // ═══════════════════════════════════════════════════════════════════════════
  const bootstrapPatterns = {
    "go to gmail": {
      tool_calls: [{ name: "navigate_browser", arguments: { url: "https://gmail.com" } }],
      confidence: 0.95,
      verification: { method: "url_check", expected: "mail.google.com", timeout_ms: 5000 },
    },
    "go to youtube": {
      tool_calls: [{ name: "navigate_browser", arguments: { url: "https://youtube.com" } }],
      confidence: 0.95,
      verification: { method: "url_check", expected: "youtube.com", timeout_ms: 5000 },
    },
    "go to google": {
      tool_calls: [{ name: "navigate_browser", arguments: { url: "https://google.com" } }],
      confidence: 0.95,
      verification: { method: "url_check", expected: "google.com", timeout_ms: 5000 },
    },
    "scroll down": {
      tool_calls: [{ name: "scroll_page", arguments: { direction: "down" } }],
      confidence: 0.95,
      verification: {
        method: "state_change",
        expected: "scroll_position_changed",
        timeout_ms: 1000,
      },
    },
    "scroll up": {
      tool_calls: [{ name: "scroll_page", arguments: { direction: "up" } }],
      confidence: 0.95,
      verification: {
        method: "state_change",
        expected: "scroll_position_changed",
        timeout_ms: 1000,
      },
    },
  };

  // Check exact bootstrap matches
  if (bootstrapPatterns[normalizedTranscript]) {
    const match = bootstrapPatterns[normalizedTranscript];
    ctx.waitUntil(incrementCacheStats(env, "instant_pattern_bootstrap_hits"));

    console.log(`🔧 BOOTSTRAP HIT: "${normalizedTranscript}" (Vectorize empty or unavailable)`);

    return jsonResponse(
      {
        instant: true,
        pattern: normalizedTranscript,
        pattern_key: `bootstrap:${normalizedTranscript.replace(/\s+/g, "_")}`,
        tool_calls: match.tool_calls,
        verification: match.verification,
        confidence: match.confidence,
        source: "bootstrap", // Renamed from 'hardcoded' to clarify purpose
        note: "Using bootstrap pattern - system will learn from executions",
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  // Check for prefix bootstrap matches
  for (const [pattern, match] of Object.entries(bootstrapPatterns)) {
    if (
      pattern.startsWith(normalizedTranscript) &&
      normalizedTranscript.length >= pattern.length * 0.7
    ) {
      ctx.waitUntil(incrementCacheStats(env, "instant_pattern_bootstrap_prefix_hits"));

      return jsonResponse(
        {
          instant: true,
          pattern,
          tool_calls: match.tool_calls,
          confidence: match.confidence * 0.9,
          source: "bootstrap_prefix",
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: NO VECTORIZE MATCH - Use LLM to plan!
  // Cloudflare has the system prompt + tools CACHED, so we can build the
  // full LLM request right here, call DeepSeek, and return tool_calls.
  // This is the FALLBACK path for NEW tasks not yet learned.
  // ═══════════════════════════════════════════════════════════════════════════

  // Check if caller wants LLM fallback (default: true for full flow)
  const use_llm_fallback = body.use_llm_fallback !== false;

  if (!use_llm_fallback) {
    // Caller explicitly disabled LLM fallback - just return no match
    return jsonResponse(
      {
        instant: false,
        note: "No learned pattern found - LLM fallback disabled by caller",
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM PLANNING: Build and send request using cached template
  // The system prompt + tools are already in KV (~6,500 tokens cached!)
  // We only send the user message (~50 tokens) = 99% token reduction!
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    // Load the cached Centris template
    const templateId = await env.CACHE?.get("template:default:latest");
    if (!templateId) {
      return jsonResponse(
        {
          instant: false,
          note: "No template cached - backend should call /api/template/preload first",
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }

    const template = await env.CACHE?.get(`template:${templateId}`, { type: "json" });
    if (!template) {
      return jsonResponse(
        {
          instant: false,
          note: "Template not found in cache",
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }

    // Build the LLM request
    const messages = [
      { role: "system", content: template.system_prompt },
      { role: "user", content: partial_transcript },
    ];

    const provider = template.provider || "deepseek";
    const model = template.model || "deepseek-chat";

    console.log(
      `⚡ LLM FALLBACK: No Vectorize match for "${normalizedTranscript}", calling ${provider}/${model}`,
    );

    // Call LLM via AI Gateway (with caching!)
    // Uses the existing callExternalProvider function which routes through AI Gateway
    const llmResponse = await callExternalProvider(
      provider,
      messages,
      model,
      0.3, // Lower temp for more deterministic tool calls
      1024, // max_tokens
      template.tools,
      "auto", // tool_choice
      env,
    );

    if (llmResponse.error) {
      return jsonResponse(
        {
          instant: false,
          note: `LLM call failed: ${llmResponse.error}`,
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }

    // Extract tool calls from LLM response
    const toolCalls = llmResponse.choices?.[0]?.message?.tool_calls || [];

    if (toolCalls.length === 0) {
      // LLM didn't return tool calls - might be a question or something else
      return jsonResponse(
        {
          instant: false,
          llm_response: llmResponse.choices?.[0]?.message?.content,
          note: "LLM did not return tool calls - may not be an actionable command",
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }

    // Format tool calls for execution
    const formattedToolCalls = toolCalls.map((tc) => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
    }));

    ctx.waitUntil(incrementCacheStats(env, "instant_pattern_llm_fallback"));

    console.log(
      `✅ LLM PLANNED: "${normalizedTranscript}" → ${formattedToolCalls.length} tool calls`,
    );

    return jsonResponse(
      {
        instant: true, // We CAN execute instantly, just from LLM not Vectorize
        pattern: normalizedTranscript,
        tool_calls: formattedToolCalls,
        confidence: 1.0, // LLM planned it, so confidence is high
        source: "llm_planned", // Indicates this came from LLM, not Vectorize
        note: "New task - LLM planned execution. Will be indexed after success.",
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  } catch (error) {
    console.error("LLM fallback error:", error);
    return jsonResponse(
      {
        instant: false,
        note: `LLM fallback failed: ${error.message}`,
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }
}

/**
 * Generate embedding using Workers AI.
 * Uses bge-base-en-v1.5 (768 dimensions) to match Vectorize index configuration.
 * Note: Must match the dimensions specified when creating the Vectorize index.
 */
async function generateEmbedding(env, text) {
  if (!env.AI) {
    throw new Error("Workers AI not configured");
  }

  const result = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  });

  return result.data[0];
}

/**
 * Export patterns for LLM training data.
 *
 * GET /api/patterns/export?format=jsonl&min_success=3
 *
 * Returns patterns in training-ready format:
 * - JSONL (default): One JSON object per line, ready for fine-tuning
 * - JSON: Array of pattern objects
 * - CSV: Spreadsheet-friendly format
 *
 * This is the KEY endpoint for building custom LLM training data!
 * After collecting enough patterns, export and use for fine-tuning.
 */
async function handlePatternExport(request, env, ctx, corsHeaders, startTime) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "jsonl";
  const minSuccess = parseInt(url.searchParams.get("min_success") || "1", 10);
  const domain = url.searchParams.get("domain");
  const limit = parseInt(url.searchParams.get("limit") || "1000", 10);

  if (!env.CACHE) {
    return jsonResponse({ error: "Cache not configured" }, corsHeaders, 500);
  }

  // Get all pattern keys from stats
  // Note: In production, you'd use KV list() with proper pagination
  const patterns = [];

  // Get pattern stats to find all patterns
  const statsKey = "__pattern_stats__";
  const stats = (await env.CACHE.get(statsKey, { type: "json" })) || { pattern_ids: [] };

  for (const patternId of stats.pattern_ids.slice(0, limit)) {
    const pattern = await env.CACHE.get(patternId, { type: "json" });
    if (pattern) {
      // Filter by minimum success count
      if ((pattern.success_count || 0) < minSuccess) {
        continue;
      }
      // Filter by domain if specified
      if (domain && pattern.domain !== domain) {
        continue;
      }

      patterns.push({
        id: patternId,
        pattern: pattern.pattern,
        tool_calls: pattern.tool_calls,
        domain: pattern.domain,
        success_count: pattern.success_count || 0,
        first_seen: pattern.first_seen,
        last_used: pattern.last_used,
      });
    }
  }

  // Sort by success count (most successful first)
  patterns.sort((a, b) => (b.success_count || 0) - (a.success_count || 0));

  // Format output
  if (format === "jsonl") {
    // JSONL format for LLM fine-tuning
    // Format: {"messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
    const lines = patterns.map((p) => {
      // Convert tool_calls to a JSON string for the assistant response
      const assistantContent = JSON.stringify({
        thought: `Executing pattern: ${p.pattern}`,
        tool_calls: p.tool_calls,
      });

      return JSON.stringify({
        messages: [
          { role: "user", content: p.pattern },
          { role: "assistant", content: assistantContent },
        ],
        // Metadata for filtering
        _meta: {
          domain: p.domain,
          success_count: p.success_count,
          pattern_id: p.id,
        },
      });
    });

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `attachment; filename="centris-patterns-${Date.now()}.jsonl"`,
        ...corsHeaders,
      },
    });
  }

  if (format === "csv") {
    // CSV format for analysis
    const header = "pattern,domain,success_count,tool_calls_json,first_seen,last_used";
    const rows = patterns.map((p) => {
      const escapedPattern = `"${(p.pattern || "").replace(/"/g, '""')}"`;
      const toolCallsJson = `"${JSON.stringify(p.tool_calls || []).replace(/"/g, '""')}"`;
      return `${escapedPattern},${p.domain || ""},${p.success_count},${toolCallsJson},${p.first_seen || ""},${p.last_used || ""}`;
    });

    return new Response([header, ...rows].join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="centris-patterns-${Date.now()}.csv"`,
        ...corsHeaders,
      },
    });
  }

  // Default: JSON format
  return jsonResponse(
    {
      patterns,
      count: patterns.length,
      filters: { min_success: minSuccess, domain, limit },
      export_format: format,
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Get pattern statistics for monitoring the learning system.
 */
async function handlePatternStats(request, env, ctx, corsHeaders) {
  if (!env.CACHE) {
    return jsonResponse({ error: "Cache not configured" }, corsHeaders, 500);
  }

  const statsKey = "__pattern_stats__";
  const stats = (await env.CACHE.get(statsKey, { type: "json" })) || {
    total_patterns: 0,
    patterns_by_domain: {},
    pattern_ids: [],
    instant_hits: 0,
    instant_misses: 0,
    last_updated: null,
  };

  // Calculate additional metrics
  const instantHitRate =
    stats.instant_hits + stats.instant_misses > 0
      ? Math.round((stats.instant_hits / (stats.instant_hits + stats.instant_misses)) * 100)
      : 0;

  return jsonResponse(
    {
      ...stats,
      metrics: {
        instant_hit_rate: `${instantHitRate}%`,
        unique_domains: Object.keys(stats.patterns_by_domain || {}).length,
      },
      learning_status:
        stats.total_patterns > 100 ? "mature" : stats.total_patterns > 20 ? "growing" : "initial",
    },
    corsHeaders,
  );
}

/**
 * Bulk index patterns (for seeding or migrating from other sources).
 *
 * POST /api/patterns/bulk-index
 * {
 *   "patterns": [
 *     {"pattern": "go to gmail", "tool_calls": [...], "domain": "gmail.com"},
 *     ...
 *   ]
 * }
 *
 * Useful for:
 * - Seeding initial patterns for new deployments
 * - Importing patterns from training data
 * - Migrating between Cloudflare accounts
 */
async function handlePatternBulkIndex(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const { patterns = [] } = body;

  if (!Array.isArray(patterns) || patterns.length === 0) {
    return jsonResponse({ error: "patterns array required" }, corsHeaders, 400);
  }

  const results = {
    indexed: 0,
    failed: 0,
    errors: [],
  };

  // Process in batches to avoid timeouts
  const batchSize = 10;
  for (let i = 0; i < patterns.length; i += batchSize) {
    const batch = patterns.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (p) => {
        try {
          if (!p.pattern || !p.tool_calls) {
            results.failed++;
            results.errors.push(`Invalid pattern: missing required fields`);
            return;
          }

          // Generate pattern ID (max 64 bytes for Vectorize)
          const hash = await hashString(p.pattern.toLowerCase());
          const patternId = `p:${hash.slice(0, 56)}`; // "p:" + 56 chars = 58 bytes (safe)

          const patternData = {
            pattern: p.pattern,
            tool_calls: p.tool_calls,
            domain: p.domain || "",
            user_id: p.user_id || "seed",
            success_count: p.success_count || 1,
            first_seen: p.first_seen || new Date().toISOString(),
            last_used: new Date().toISOString(),
            source: "bulk_import",
          };

          // Store in KV
          if (env.CACHE) {
            await env.CACHE.put(patternId, JSON.stringify(patternData), {
              expirationTtl: 2592000, // 30 days
            });
          }

          // Index in Vectorize using PATTERNS binding
          if (env.PATTERNS) {
            const embedding = await generateEmbedding(env, p.pattern);
            await env.PATTERNS.upsert([
              {
                id: patternId,
                values: embedding,
                metadata: {
                  pattern: p.pattern.substring(0, 100),
                  domain: p.domain || "",
                  type: p.type || "simple_pattern", // Support both simple and task patterns in bulk
                },
              },
            ]);
          }

          results.indexed++;

          // Update pattern stats
          await updatePatternStats(env, patternId, p.domain);
        } catch (error) {
          results.failed++;
          results.errors.push(
            `Failed to index '${p.pattern?.substring(0, 30)}...': ${error.message}`,
          );
        }
      }),
    );
  }

  return jsonResponse(
    {
      ...results,
      total_submitted: patterns.length,
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🌱 PATTERN SEEDING & FAILURE TRACKING HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Seed simple patterns into KV and Vectorize.
 * This is the admin endpoint for bulk seeding from the simple_patterns.json file.
 *
 * POST /api/patterns/seed
 * {
 *   "kv_records": [{ key: "pattern:nav:gmail", value: {...} }],
 *   "vectorize_records": [{ id: "pattern:nav:gmail", text: "go to gmail", metadata: {...} }]
 * }
 *
 * FLOW:
 *   1. Validate auth header
 *   2. Store KV records (for instant O(1) lookup)
 *   3. Generate embeddings and store in Vectorize (for semantic search)
 *   4. Initialize failure tracking config
 */
async function handlePatternSeed(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  // Verify auth (optional - check X-Seed-Auth header)
  const authHeader = request.headers.get("X-Seed-Auth");
  const expectedAuth = env.SEED_AUTH_KEY || "dev-seed-key";
  if (authHeader && authHeader !== expectedAuth) {
    return jsonResponse({ error: "Unauthorized" }, corsHeaders, 401);
  }

  const body = await request.json();
  const { kv_records = [], vectorize_records = [] } = body;

  const results = {
    kv_indexed: 0,
    vectorize_indexed: 0,
    errors: [],
  };

  // Step 1: Store KV records
  if (env.CACHE && kv_records.length > 0) {
    for (const record of kv_records) {
      try {
        await env.CACHE.put(record.key, JSON.stringify(record.value), {
          expirationTtl: 2592000, // 30 days
        });
        results.kv_indexed++;
      } catch (error) {
        results.errors.push(`KV error for ${record.key}: ${error.message}`);
      }
    }
  }

  // Step 2: Generate embeddings and store in Vectorize
  if (env.PATTERNS && env.AI && vectorize_records.length > 0) {
    const vectors = [];

    for (const record of vectorize_records) {
      try {
        const embedding = await generateEmbedding(env, record.text);
        vectors.push({
          id: record.id,
          values: embedding,
          metadata: record.metadata || {},
        });
      } catch (error) {
        results.errors.push(`Embedding error for ${record.id}: ${error.message}`);
      }
    }

    if (vectors.length > 0) {
      try {
        await env.PATTERNS.upsert(vectors);
        results.vectorize_indexed = vectors.length;
      } catch (error) {
        results.errors.push(`Vectorize upsert error: ${error.message}`);
      }
    }
  }

  // Step 3: Initialize failure tracking config if not exists
  if (env.CACHE) {
    const existingConfig = await env.CACHE.get("config:failure_tracking", { type: "json" });
    if (!existingConfig) {
      await env.CACHE.put(
        "config:failure_tracking",
        JSON.stringify({
          failure_threshold: 3,
          penalty_duration_hours: 24,
          boost_on_success: 0.05,
          penalty_on_failure: 0.15,
        }),
        { expirationTtl: 2592000 },
      );
    }

    const existingFailures = await env.CACHE.get("known_failures", { type: "json" });
    if (!existingFailures) {
      await env.CACHE.put(
        "known_failures",
        JSON.stringify({
          patterns: {},
          last_updated: new Date().toISOString(),
        }),
        { expirationTtl: 2592000 },
      );
    }
  }

  ctx.waitUntil(incrementCacheStats(env, "patterns_seeded"));

  return jsonResponse(
    {
      success: true,
      indexed: results.kv_indexed + results.vectorize_indexed,
      kv_indexed: results.kv_indexed,
      vectorize_indexed: results.vectorize_indexed,
      errors: results.errors.length > 0 ? results.errors : undefined,
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Contribute a new pattern learned from successful LLM parse.
 * This creates a LEARNING LOOP:
 *   1. User says something new that LLM (Tier 3) parses successfully
 *   2. Backend contributes the pattern here
 *   3. Next time someone says something similar, Tier 2 (Vectorize) catches it
 *   4. Result: ~50ms instead of ~400ms for similar queries
 *
 * POST /api/patterns/contribute
 * {
 *   "intent": "open whatsapp and send a message to Mandy Pecher I love u",
 *   "category": "desktop_action",
 *   "action": "send_message",
 *   "parsed_fields": {
 *     "app_name": "WhatsApp",
 *     "contact": "Mandy Pecher",
 *     "message": "I love u"
 *   },
 *   "regex": "optional regex pattern hint",
 *   "source": "llm_parse"  // marks as learned from LLM
 * }
 *
 * This endpoint:
 *   1. Generates embedding for the intent
 *   2. Stores in Vectorize for future semantic matching
 *   3. Optionally stores regex hint in KV for Tier 2 matching
 *   4. Tracks learning stats
 */
async function handlePatternContribute(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    intent,
    category = "desktop_action",
    action,
    parsed_fields = {},
    regex = null,
    source = "llm_parse",
  } = body;

  if (!intent || !action) {
    return jsonResponse(
      {
        error: "Missing required fields: intent, action",
      },
      corsHeaders,
      400,
    );
  }

  const results = {
    vectorize_indexed: false,
    kv_stored: false,
    errors: [],
  };

  // Generate unique ID for this pattern
  const patternId = `learned:${category}:${action}:${Date.now()}`;

  // Step 1: Generate embedding and store in Vectorize
  if (env.PATTERNS && env.AI) {
    try {
      // Import generalization function from pattern-vectorize
      const { generalizePattern } = await import("./pattern-vectorize.js");
      const { generalized, extractions } = generalizePattern(intent);

      // Generate embedding for the generalized intent
      const embedding = await generateEmbedding(env, generalized);

      // Store in Vectorize
      await env.PATTERNS.upsert([
        {
          id: patternId,
          values: embedding,
          metadata: {
            category,
            action,
            intent: intent, // Original for display
            generalized_intent: generalized, // Generalized for matching
            parsed_fields: JSON.stringify(parsed_fields),
            regex: regex || "",
            source,
            learned_at: new Date().toISOString(),
            type: "learned_pattern",
          },
        },
      ]);

      results.vectorize_indexed = true;
    } catch (error) {
      results.errors.push(`Vectorize error: ${error.message}`);
    }
  }

  // Step 2: Store regex hint in KV if provided (for Tier 2 matching)
  if (env.CACHE && regex) {
    try {
      const kvKey = `learned_regex:${category}:${action}:${Date.now()}`;
      await env.CACHE.put(
        kvKey,
        JSON.stringify({
          intent,
          category,
          action,
          regex,
          parsed_fields,
          source,
          learned_at: new Date().toISOString(),
        }),
        {
          expirationTtl: 2592000, // 30 days
        },
      );
      results.kv_stored = true;
    } catch (error) {
      results.errors.push(`KV error: ${error.message}`);
    }
  }

  // Step 3: Update learning stats
  if (env.CACHE) {
    ctx.waitUntil(
      (async () => {
        try {
          const statsKey = `learning_stats:${category}`;
          const stats = (await env.CACHE.get(statsKey, { type: "json" })) || {
            patterns_learned: 0,
            by_action: {},
            last_learned: null,
          };

          stats.patterns_learned++;
          stats.by_action[action] = (stats.by_action[action] || 0) + 1;
          stats.last_learned = new Date().toISOString();

          await env.CACHE.put(statsKey, JSON.stringify(stats), {
            expirationTtl: 2592000,
          });
        } catch (e) {
          console.error("Failed to update learning stats:", e);
        }
      })(),
    );
  }

  return jsonResponse(
    {
      success: results.vectorize_indexed || results.kv_stored,
      pattern_id: patternId,
      vectorize_indexed: results.vectorize_indexed,
      kv_stored: results.kv_stored,
      errors: results.errors.length > 0 ? results.errors : undefined,
      latency_ms: Date.now() - startTime,
      message: results.vectorize_indexed
        ? "Pattern learned! Similar queries will now be faster (~50ms vs ~400ms)"
        : "Pattern stored but Vectorize not available",
    },
    corsHeaders,
  );
}

/**
 * Record execution result and update failure tracking.
 * Called AFTER tool execution to verify success and update confidence scores.
 *
 * POST /api/patterns/verify
 * {
 *   "pattern_key": "pattern:nav:gmail",
 *   "success": true,
 *   "execution_time_ms": 1500,
 *   "verification_result": {
 *     "method": "url_check",
 *     "expected": "mail.google.com",
 *     "actual": "mail.google.com",
 *     "passed": true
 *   }
 * }
 *
 * FLOW:
 *   1. Check if pattern should be skipped (known failure)
 *   2. Update pattern record with execution stats
 *   3. Update failure tracking (boost on success, penalize on failure)
 *   4. Return updated confidence score
 */
async function handlePatternVerify(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const { pattern_key, success, execution_time_ms = 0, verification_result = null } = body;

  if (!pattern_key) {
    return jsonResponse({ error: "pattern_key required" }, corsHeaders, 400);
  }

  if (!env.CACHE) {
    return jsonResponse({ error: "KV not available" }, corsHeaders, 500);
  }

  // Get config
  const config = (await env.CACHE.get("config:failure_tracking", { type: "json" })) || {
    failure_threshold: 3,
    penalty_duration_hours: 24,
    boost_on_success: 0.05,
    penalty_on_failure: 0.15,
  };

  // Update pattern record
  const pattern = await env.CACHE.get(pattern_key, { type: "json" });
  if (!pattern) {
    return jsonResponse({ error: "Pattern not found", pattern_key }, corsHeaders, 404);
  }

  const now = new Date().toISOString();

  pattern.execution_count = (pattern.execution_count || 0) + 1;
  pattern.last_used = now;

  if (success) {
    pattern.success_count = (pattern.success_count || 0) + 1;
    pattern.last_success = now;
    pattern.confidence_score = Math.min(
      1.0,
      (pattern.confidence_score || 0.85) + config.boost_on_success,
    );
  } else {
    pattern.failure_count = (pattern.failure_count || 0) + 1;
    pattern.last_failure = now;
    pattern.confidence_score = Math.max(
      0.5,
      (pattern.confidence_score || 0.85) - config.penalty_on_failure,
    );
  }

  pattern.success_rate =
    pattern.execution_count > 0 ? pattern.success_count / pattern.execution_count : null;

  if (execution_time_ms > 0) {
    pattern.avg_execution_time_ms = pattern.avg_execution_time_ms
      ? pattern.avg_execution_time_ms * 0.9 + execution_time_ms * 0.1
      : execution_time_ms;
  }

  // Store verification result if provided
  if (verification_result) {
    pattern.last_verification = verification_result;
  }

  await env.CACHE.put(pattern_key, JSON.stringify(pattern), {
    expirationTtl: 2592000,
  });

  // Update failure tracking
  const failures = (await env.CACHE.get("known_failures", { type: "json" })) || {
    patterns: {},
    last_updated: now,
  };

  if (success) {
    // Reset failure tracking on success
    if (failures.patterns[pattern_key]) {
      delete failures.patterns[pattern_key];
      failures.last_updated = now;
      await env.CACHE.put("known_failures", JSON.stringify(failures), {
        expirationTtl: 2592000,
      });
    }
    ctx.waitUntil(incrementCacheStats(env, "pattern_verifications_success"));
  } else {
    // Increment failure tracking
    const existing = failures.patterns[pattern_key] || {
      consecutive_failures: 0,
      first_failure: now,
    };

    existing.consecutive_failures++;
    existing.last_failure = now;

    // Apply penalty if threshold reached
    if (existing.consecutive_failures >= config.failure_threshold) {
      const penaltyEnd = new Date();
      penaltyEnd.setHours(penaltyEnd.getHours() + config.penalty_duration_hours);
      existing.penalty_until = penaltyEnd.toISOString();
      existing.penalty_reason = "Too many consecutive failures";
    }

    failures.patterns[pattern_key] = existing;
    failures.last_updated = now;

    await env.CACHE.put("known_failures", JSON.stringify(failures), {
      expirationTtl: 2592000,
    });

    ctx.waitUntil(incrementCacheStats(env, "pattern_verifications_failure"));
  }

  return jsonResponse(
    {
      success: true,
      pattern_key,
      execution_success: success,
      new_confidence_score: pattern.confidence_score,
      success_rate: pattern.success_rate ? Math.round(pattern.success_rate * 100) + "%" : "N/A",
      execution_count: pattern.execution_count,
      is_penalized: failures.patterns[pattern_key]?.penalty_until
        ? new Date(failures.patterns[pattern_key].penalty_until) > new Date()
        : false,
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Get known failures list (patterns to skip in instant execution).
 *
 * GET /api/patterns/failures
 *
 * Returns patterns that have failed too many times and are currently
 * in penalty period. These should be skipped for instant execution
 * and routed to LLM instead.
 */
async function handlePatternFailures(request, env, ctx, corsHeaders) {
  if (!env.CACHE) {
    return jsonResponse({ error: "KV not available" }, corsHeaders, 500);
  }

  const failures = (await env.CACHE.get("known_failures", { type: "json" })) || {
    patterns: {},
    last_updated: null,
  };

  const config = (await env.CACHE.get("config:failure_tracking", { type: "json" })) || {
    failure_threshold: 3,
    penalty_duration_hours: 24,
  };

  const now = new Date();
  const activeFailures = {};
  const expiredFailures = [];

  // Filter to only active penalties
  for (const [key, failure] of Object.entries(failures.patterns)) {
    if (failure.penalty_until) {
      const penaltyEnd = new Date(failure.penalty_until);
      if (penaltyEnd > now) {
        activeFailures[key] = {
          ...failure,
          penalty_remaining_minutes: Math.round((penaltyEnd - now) / 60000),
        };
      } else {
        expiredFailures.push(key);
      }
    } else if (failure.consecutive_failures >= config.failure_threshold) {
      // Should be penalized but isn't - add penalty now
      const penaltyEnd = new Date();
      penaltyEnd.setHours(penaltyEnd.getHours() + config.penalty_duration_hours);
      failure.penalty_until = penaltyEnd.toISOString();
      activeFailures[key] = {
        ...failure,
        penalty_remaining_minutes: config.penalty_duration_hours * 60,
      };
    }
  }

  // Clean up expired failures in background
  if (expiredFailures.length > 0) {
    ctx.waitUntil(
      (async () => {
        for (const key of expiredFailures) {
          delete failures.patterns[key];
        }
        failures.last_updated = now.toISOString();
        await env.CACHE.put("known_failures", JSON.stringify(failures), {
          expirationTtl: 2592000,
        });
      })(),
    );
  }

  return jsonResponse(
    {
      success: true,
      active_failures: activeFailures,
      active_count: Object.keys(activeFailures).length,
      expired_count: expiredFailures.length,
      config: {
        failure_threshold: config.failure_threshold,
        penalty_duration_hours: config.penalty_duration_hours,
      },
      last_updated: failures.last_updated,
    },
    corsHeaders,
  );
}

/**
 * Check if a pattern should be skipped due to known failures.
 * This is a helper function used internally by handlePatternInstant.
 *
 * @param {Object} env - Cloudflare worker environment
 * @param {string} patternKey - Pattern key to check
 * @returns {Promise<{skip: boolean, reason?: string}>}
 */
async function checkKnownFailures(env, patternKey) {
  if (!env.CACHE) {
    return { skip: false };
  }

  const failures = await env.CACHE.get("known_failures", { type: "json" });
  if (!failures?.patterns?.[patternKey]) {
    return { skip: false };
  }

  const failure = failures.patterns[patternKey];

  // Check if penalty period is active
  if (failure.penalty_until) {
    const penaltyEnd = new Date(failure.penalty_until);
    if (new Date() < penaltyEnd) {
      return {
        skip: true,
        reason: `Pattern penalized until ${failure.penalty_until}`,
        consecutive_failures: failure.consecutive_failures,
      };
    }
  }

  return { skip: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎓 TASK PATTERN LEARNING HANDLERS - Self-improving workflow system
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Index a learned task pattern (complex workflow template).
 *
 * POST /api/task-patterns/index
 *
 * This is the SELF-LEARNING endpoint that stores complex workflow patterns
 * generated from successful multi-step executions.
 *
 * Unlike simple command patterns (go to gmail → navigate), these are full
 * workflow templates with:
 * - Execution flow (10-30+ steps)
 * - Decision points (branching logic)
 * - Error recovery patterns
 * - Parallel execution opportunities
 *
 * Input:
 * {
 *   "id": "research-compare-products-abc123",
 *   "intent": "Compare {product_name} prices across {retailer}",
 *   "complexity": "high",
 *   "category": "research",
 *   "example_queries": ["Compare AirPods prices...", "Find best deal on..."],
 *   "domains": ["amazon.com", "bestbuy.com"],
 *   "tools_required": ["navigate_browser", "get_interactive_snapshot", ...],
 *   "execution_flow": [
 *     {"step": 1, "action": "navigate_browser", "description": "Navigate to {site_1}"},
 *     ...
 *   ],
 *   "decision_points": [...],
 *   "error_recovery": {...},
 *   "success_criteria": {...}
 * }
 */
async function handleTaskPatternIndex(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    id,
    intent,
    complexity = "medium",
    category = "general",
    example_queries = [],
    domains = [],
    tools_required = [],
    preconditions = [],
    execution_flow = [],
    decision_points = [],
    error_recovery = {},
    parallel_execution = {},
    success_criteria = {},
    estimated_duration_seconds = 30,
    confirmation_required = false,
    source_trace_id = null,
    auto_generated = true,
  } = body;

  if (!id || !intent) {
    return jsonResponse({ error: "id and intent required" }, corsHeaders, 400);
  }

  if (execution_flow.length < 3) {
    return jsonResponse(
      {
        error: "Task patterns require at least 3 execution steps",
        received: execution_flow.length,
      },
      corsHeaders,
      400,
    );
  }

  // Generate task pattern ID (prefix with "tp:" to distinguish from simple patterns)
  const taskPatternId = `tp:${id}`;

  // Build the full task pattern record
  const taskPattern = {
    id,
    intent,
    complexity,
    category,
    example_queries,
    domains,
    tools_required,
    preconditions,
    execution_flow,
    decision_points,
    error_recovery,
    parallel_execution,
    success_criteria,
    estimated_duration_seconds,
    confirmation_required,
    source_trace_id,
    auto_generated,
    // Metadata
    indexed_at: new Date().toISOString(),
    version: 1,
    usage_count: 0,
    success_rate: 1.0, // Starts at 100% (from successful execution)
  };

  // Store in KV for full details retrieval
  if (env.CACHE) {
    await env.CACHE.put(taskPatternId, JSON.stringify(taskPattern), {
      expirationTtl: 7776000, // 90 days (longer for workflow patterns)
    });
  }

  // Index in Vectorize for semantic search
  // Use intent + first example for better matching
  let vectorizeSuccess = false;
  // Note: PATTERNS binding is configured in wrangler.toml for centris-patterns index
  if (env.PATTERNS) {
    try {
      const searchText = `${intent} ${example_queries[0] || ""}`;
      const embedding = await generateEmbedding(env, searchText);

      await env.PATTERNS.upsert([
        {
          id: taskPatternId,
          values: embedding,
          metadata: {
            intent: intent.substring(0, 100),
            category,
            complexity,
            steps: execution_flow.length,
            domains: domains.slice(0, 3).join(","),
            type: "task_pattern", // Distinguish from simple patterns
            auto_generated: auto_generated ? "true" : "false",
          },
        },
      ]);
      vectorizeSuccess = true;
      console.log(`✅ Task pattern indexed in Vectorize: ${taskPatternId}`);
    } catch (error) {
      console.error("Vectorize indexing failed:", error);
    }
  } else {
    console.warn("PATTERNS binding not available - task pattern not indexed in Vectorize");
  }

  // Update task pattern stats
  await updateTaskPatternStats(env, category, complexity);

  ctx.waitUntil(incrementCacheStats(env, "task_patterns_indexed"));

  return jsonResponse(
    {
      indexed: true,
      pattern_id: taskPatternId,
      vectorize_indexed: vectorizeSuccess,
      complexity,
      category,
      execution_steps: execution_flow.length,
      decision_points: decision_points.length,
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Search for similar task patterns (returns workflow scaffolds).
 *
 * POST /api/task-patterns/search
 *
 * Uses Vectorize semantic search to find task patterns similar to the
 * user's request. Returns full workflow scaffolds that the LLM can
 * adapt to the specific task.
 *
 * Input:
 * {
 *   "query": "Compare MacBook prices across stores",
 *   "top_k": 3,
 *   "min_score": 0.65,
 *   "category": "research"  // optional filter
 * }
 *
 * Output:
 * {
 *   "matches": [
 *     {
 *       "id": "tp:research-compare-products-abc123",
 *       "score": 0.89,
 *       "pattern": { full task pattern object }
 *     }
 *   ]
 * }
 */
async function handleTaskPatternSearch(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const { query, top_k = 3, min_score = 0.65, category = null } = body;

  if (!query) {
    return jsonResponse({ error: "query required" }, corsHeaders, 400);
  }

  if (!env.PATTERNS) {
    return jsonResponse(
      {
        error: "PATTERNS binding not configured in wrangler.toml",
        matches: [],
      },
      corsHeaders,
      503,
    );
  }

  try {
    // Generate embedding for query
    const embedding = await generateEmbedding(env, query);

    // Build optional filter for category
    // Note: type filter removed as Vectorize metadata filtering can be inconsistent
    // Semantic search naturally finds task patterns based on intent similarity
    const filter = category ? { category } : undefined;

    // Search Vectorize using PATTERNS binding
    const results = await env.PATTERNS.query(embedding, {
      topK: top_k,
      filter,
      returnMetadata: true,
    });

    // Filter by min_score and load full patterns from KV
    // IMPORTANT: Only include task_patterns (with execution_flow), not simple_patterns
    const matches = [];
    for (const match of results.matches || []) {
      if (match.score >= min_score) {
        // Check metadata type - only include task_patterns, not simple_patterns
        const patternType = match.metadata?.type || "";
        if (patternType === "simple_pattern") {
          console.log(`⚠️ Skipping simple_pattern in task-patterns search: ${match.id}`);
          continue; // Skip simple patterns - they don't have execution_flow
        }

        // Load full pattern from KV
        let fullPattern = null;
        if (env.CACHE) {
          fullPattern = await env.CACHE.get(match.id, { type: "json" });
        }

        // Double-check: Only include patterns that have execution_flow
        if (
          fullPattern &&
          (!fullPattern.execution_flow || fullPattern.execution_flow.length === 0)
        ) {
          console.log(`⚠️ Pattern ${match.id} has no execution_flow, skipping`);
          continue;
        }

        matches.push({
          id: match.id,
          score: match.score,
          metadata: match.metadata,
          pattern: fullPattern,
        });
      }
    }

    ctx.waitUntil(incrementCacheStats(env, "task_pattern_searches"));

    return jsonResponse(
      {
        matches,
        query: query.substring(0, 50),
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  } catch (error) {
    console.error("Task pattern search error:", error);
    return jsonResponse(
      {
        error: error.message,
        matches: [],
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
      500,
    );
  }
}

/**
 * Get task pattern statistics.
 *
 * GET /api/task-patterns/stats
 */
async function handleTaskPatternStats(request, env, ctx, corsHeaders) {
  const stats = {
    task_patterns: 0,
    by_category: {},
    by_complexity: {},
    recent_patterns: [],
  };

  if (env.CACHE) {
    // Get task pattern stats from cache
    const taskStats = await env.CACHE.get("task_pattern_stats", { type: "json" });
    if (taskStats) {
      stats.task_patterns = taskStats.total || 0;
      stats.by_category = taskStats.by_category || {};
      stats.by_complexity = taskStats.by_complexity || {};
    }

    // Get recent patterns
    const recentList = await env.CACHE.get("task_patterns_recent", { type: "json" });
    if (recentList && Array.isArray(recentList)) {
      stats.recent_patterns = recentList.slice(0, 10);
    }
  }

  return jsonResponse(stats, corsHeaders);
}

/**
 * Update task pattern statistics.
 */
async function updateTaskPatternStats(env, category, complexity) {
  if (!env.CACHE) {
    return;
  }

  try {
    const stats = (await env.CACHE.get("task_pattern_stats", { type: "json" })) || {
      total: 0,
      by_category: {},
      by_complexity: {},
    };

    stats.total++;
    stats.by_category[category] = (stats.by_category[category] || 0) + 1;
    stats.by_complexity[complexity] = (stats.by_complexity[complexity] || 0) + 1;

    await env.CACHE.put("task_pattern_stats", JSON.stringify(stats), {
      expirationTtl: 86400, // 24 hours
    });

    // Track recent patterns
    const recent = (await env.CACHE.get("task_patterns_recent", { type: "json" })) || [];
    recent.unshift({
      category,
      complexity,
      timestamp: new Date().toISOString(),
    });

    await env.CACHE.put("task_patterns_recent", JSON.stringify(recent.slice(0, 50)), {
      expirationTtl: 86400,
    });
  } catch (error) {
    console.error("Failed to update task pattern stats:", error);
  }
}

/**
 * Export execution logs for LLM training.
 *
 * GET /api/executions/export?start_date=2026-01-01&end_date=2026-01-12&format=jsonl
 *
 * This exports the FULL execution history (not deduplicated patterns).
 * Each record includes:
 * - User command (pattern)
 * - Exact tool calls executed
 * - Success/failure status
 * - Execution time
 * - Browser context at time of execution
 *
 * Perfect for fine-tuning LLMs on real user behavior!
 */
async function handleExecutionExport(request, env, ctx, corsHeaders, startTime) {
  const url = new URL(request.url);
  const startDate =
    url.searchParams.get("start_date") ||
    new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const endDate = url.searchParams.get("end_date") || new Date().toISOString().split("T")[0];
  const format = url.searchParams.get("format") || "jsonl";
  const successOnly = url.searchParams.get("success_only") === "true";
  const limit = parseInt(url.searchParams.get("limit") || "10000", 10);

  if (!env.CACHE) {
    return jsonResponse({ error: "Cache not configured" }, corsHeaders, 500);
  }

  const executions = [];

  // Iterate through date range
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end && executions.length < limit) {
    const dateStr = current.toISOString().split("T")[0];
    const dailyKey = `daily:${dateStr}`;

    const daily = await env.CACHE.get(dailyKey, { type: "json" });
    if (daily?.executions) {
      // Fetch each execution log
      for (const execId of daily.executions) {
        if (executions.length >= limit) {
          break;
        }

        const exec = await env.CACHE.get(execId, { type: "json" });
        if (exec) {
          if (successOnly && !exec.success) {
            continue;
          }
          executions.push(exec);
        }
      }
    }

    current.setDate(current.getDate() + 1);
  }

  // Format output
  if (format === "jsonl") {
    // JSONL format optimized for LLM fine-tuning
    const lines = executions.map((exec) => {
      return JSON.stringify({
        messages: [
          {
            role: "system",
            content: exec.browser_context
              ? `Current page: ${exec.browser_context.url || "unknown"}`
              : "Browser automation assistant.",
          },
          {
            role: "user",
            content: exec.pattern,
          },
          {
            role: "assistant",
            content: JSON.stringify({
              thought: `Executing: ${exec.pattern}`,
              tool_calls: exec.tool_calls,
            }),
          },
        ],
        _meta: {
          success: exec.success,
          execution_time_ms: exec.execution_time_ms,
          domain: exec.domain,
          timestamp: exec.timestamp,
          pattern_id: exec.pattern_id,
        },
      });
    });

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `attachment; filename="centris-executions-${startDate}-to-${endDate}.jsonl"`,
        ...corsHeaders,
      },
    });
  }

  // JSON format
  return jsonResponse(
    {
      executions,
      count: executions.length,
      date_range: { start: startDate, end: endDate },
      filters: { success_only: successOnly, limit },
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Get execution log for a specific date.
 *
 * GET /api/executions/daily?date=2026-01-12
 */
async function handleDailyExecutions(request, env, ctx, corsHeaders, startTime) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().split("T")[0];

  if (!env.CACHE) {
    return jsonResponse({ error: "Cache not configured" }, corsHeaders, 500);
  }

  const dailyKey = `daily:${date}`;
  const daily = await env.CACHE.get(dailyKey, { type: "json" });

  if (!daily) {
    return jsonResponse(
      {
        date,
        executions: [],
        count: 0,
        message: "No executions logged for this date",
      },
      corsHeaders,
    );
  }

  // Fetch execution details
  const executions = [];
  for (const execId of daily.executions) {
    const exec = await env.CACHE.get(execId, { type: "json" });
    if (exec) {
      executions.push({
        id: execId,
        ...exec,
      });
    }
  }

  // Calculate stats
  const successCount = executions.filter((e) => e.success).length;
  const failureCount = executions.filter((e) => !e.success).length;
  const avgTime =
    executions.length > 0
      ? executions.reduce((sum, e) => sum + (e.execution_time_ms || 0), 0) / executions.length
      : 0;

  return jsonResponse(
    {
      date,
      executions,
      count: executions.length,
      stats: {
        success_count: successCount,
        failure_count: failureCount,
        success_rate:
          executions.length > 0
            ? Math.round((successCount / executions.length) * 100) + "%"
            : "N/A",
        avg_execution_time_ms: Math.round(avgTime),
      },
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Update pattern statistics (helper function).
 */
async function updatePatternStats(env, patternId, domain) {
  if (!env.CACHE) {
    return;
  }

  try {
    const statsKey = "__pattern_stats__";
    const stats = (await env.CACHE.get(statsKey, { type: "json" })) || {
      total_patterns: 0,
      patterns_by_domain: {},
      pattern_ids: [],
      instant_hits: 0,
      instant_misses: 0,
      last_updated: null,
    };

    // Add pattern ID if not already tracked
    if (!stats.pattern_ids.includes(patternId)) {
      stats.pattern_ids.push(patternId);
      stats.total_patterns++;
    }

    // Track by domain
    if (domain) {
      stats.patterns_by_domain[domain] = (stats.patterns_by_domain[domain] || 0) + 1;
    }

    stats.last_updated = new Date().toISOString();

    await env.CACHE.put(statsKey, JSON.stringify(stats), {
      expirationTtl: 86400 * 30, // 30 days
    });
  } catch (e) {
    console.error("Failed to update pattern stats:", e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎙️ DICTATION MODE HANDLERS
// Fast voice-to-text cleanup with aggressive caching
// ═══════════════════════════════════════════════════════════════════════════════

// Ultra-minimal dictation cleanup prompt (optimized for speed)
// Matches the backend dictation_prompt.py - kept short for fast LLM processing
const DICTATION_CLEANUP_PROMPT = `Remove filler words, add punctuation, fix capitalization. Preserve meaning and proper nouns. Return cleaned text only.`;

/**
 * Initialize dictation cleanup template.
 *
 * This caches the dictation cleanup prompt for faster subsequent requests.
 * The prompt is intentionally minimal (~50 tokens) for instant cleanup.
 *
 * POST /api/dictation/template/init
 */
async function handleDictationTemplateInit(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    custom_prompt, // Optional: override the default prompt
    provider = "deepseek",
    model = "deepseek-chat",
  } = body;

  const systemPrompt = custom_prompt || DICTATION_CLEANUP_PROMPT;

  // Generate template ID
  const contentHash = await hashString(JSON.stringify({ system_prompt: systemPrompt }));
  const templateId = `dictation-cleanup-${TEMPLATE_VERSION}-${contentHash.slice(0, 8)}`;

  // Check if already cached
  const existingTemplate = await env.CACHE?.get(`template:${templateId}`);
  if (existingTemplate) {
    ctx.waitUntil(incrementCacheStats(env, "dictation_template_hits"));

    return jsonResponse(
      {
        template_id: templateId,
        already_cached: true,
        token_estimate: Math.ceil(systemPrompt.length / 4),
        message: "Dictation template already initialized",
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  // Store template in KV
  const template = {
    template_id: templateId,
    template_name: "dictation-cleanup",
    version: TEMPLATE_VERSION,
    system_prompt: systemPrompt,
    tools: [], // Dictation cleanup doesn't use tools
    provider,
    model,
    created_at: new Date().toISOString(),
    token_estimate: Math.ceil(systemPrompt.length / 4),
    mode: "dictation",
  };

  if (env.CACHE) {
    await env.CACHE.put(`template:${templateId}`, JSON.stringify(template), {
      expirationTtl: TEMPLATE_TTL,
    });

    // Store as "latest" for easy lookup
    await env.CACHE.put("template:dictation-cleanup:latest", templateId, {
      expirationTtl: TEMPLATE_TTL,
    });

    ctx.waitUntil(incrementCacheStats(env, "dictation_template_misses"));
  }

  console.log(`[Dictation Template] Initialized: ${templateId}`);

  return jsonResponse(
    {
      template_id: templateId,
      already_cached: false,
      token_estimate: Math.ceil(systemPrompt.length / 4),
      message: "Dictation template initialized for fast cleanup",
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Handle dictation text cleanup.
 *
 * This is the FAST PATH for voice-to-text cleanup (220+ WPM target).
 * Uses aggressive caching because:
 * 1. Dictation cleanup is deterministic-ish (same text = same cleanup)
 * 2. Users often repeat common phrases
 * 3. The prompt is minimal, making cache hits very likely
 *
 * POST /api/dictation/cleanup
 * {
 *   "text": "um so like i want to um write an email to john",
 *   "provider": "deepseek",  // Optional
 *   "model": "deepseek-chat" // Optional
 * }
 *
 * Response:
 * {
 *   "cleaned_text": "I want to write an email to John.",
 *   "cached": true/false,
 *   "latency_ms": 15
 * }
 */
async function handleDictationCleanup(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    text,
    provider = "deepseek",
    model = "deepseek-chat",
    temperature = 0, // Deterministic for caching
  } = body;

  if (!text || !text.trim()) {
    return jsonResponse({ error: "text required" }, corsHeaders, 400);
  }

  const trimmedText = text.trim();

  // ===== CACHE CHECK (AGGRESSIVE) =====
  // Generate cache key from text hash
  const textHash = await hashString(trimmedText.toLowerCase());
  const cacheKey = `dictation:${model}:${textHash.slice(0, 32)}`;

  // Check for cached result (high hit rate for common phrases)
  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      ctx.waitUntil(incrementCacheStats(env, "dictation_cleanup_hits"));

      return jsonResponse(
        {
          cleaned_text: cached,
          original_text: trimmedText,
          cached: true,
          cache_key: textHash.slice(0, 8),
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }
  }

  // ===== LOAD TEMPLATE =====
  // Check for pre-loaded template (faster than sending full prompt)
  let systemPrompt = DICTATION_CLEANUP_PROMPT;
  let templateUsed = null;

  const templateId = await env.CACHE?.get("template:dictation-cleanup:latest");
  if (templateId) {
    const template = await env.CACHE.get(`template:${templateId}`, { type: "json" });
    if (template?.system_prompt) {
      systemPrompt = template.system_prompt;
      templateUsed = templateId;
    }
  }

  // ===== CALL LLM =====
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: trimmedText },
  ];

  let response;
  try {
    if (provider === "workers-ai") {
      response = await callWorkersAI(env, messages, model);
    } else {
      response = await callExternalProvider(
        provider,
        messages,
        model,
        temperature,
        200, // Short max_tokens for cleanup
        null, // No tools
        null, // No tool_choice
        env,
      );
    }
  } catch (error) {
    console.error("Dictation cleanup LLM error:", error);
    // Fallback: return original text
    return jsonResponse(
      {
        cleaned_text: trimmedText,
        original_text: trimmedText,
        cached: false,
        error: "LLM cleanup failed, returning original",
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  const cleanedText = response?.choices?.[0]?.message?.content?.trim() || trimmedText;
  const latency = Date.now() - startTime;

  // ===== CACHE RESULT =====
  // Cache for 24 hours (dictation cleanup is very cacheable)
  if (env.CACHE && cleanedText) {
    await env.CACHE.put(cacheKey, cleanedText, {
      expirationTtl: 86400, // 24 hours
    });
    ctx.waitUntil(incrementCacheStats(env, "dictation_cleanup_misses"));
  }

  console.log(
    `[Dictation Cleanup] "${trimmedText.slice(0, 30)}..." -> "${cleanedText.slice(0, 30)}..." (${latency}ms)`,
  );

  return jsonResponse(
    {
      cleaned_text: cleanedText,
      original_text: trimmedText,
      cached: false,
      template_used: templateUsed,
      provider,
      model,
      gateway_cache: response?._gateway?.cacheStatus || "unknown",
      latency_ms: latency,
    },
    corsHeaders,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📖 READING MODE HANDLERS
// Text-to-voice with summarization and vision extraction
// ═══════════════════════════════════════════════════════════════════════════════

// System prompt for reading summarization (kept short for caching efficiency)
const SUMMARIZATION_SYSTEM_PROMPT = `You are creating summaries optimized for text-to-speech reading.
Be concise, clear, and avoid jargon. Use natural language.`;

// Summarization style prompts
const SUMMARIZATION_PROMPTS = {
  brief: "Summarize this in 2-3 sentences for a quick audio summary:",
  detailed: "Create a comprehensive summary (about 500 words) covering all key points:",
  key_points: "Extract the 5 most important points as a numbered list:",
};

/**
 * Initialize reading mode templates.
 *
 * Caches the summarization prompt for faster subsequent requests.
 *
 * POST /api/reading/template/init
 */
async function handleReadingTemplateInit(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const { provider = "openai", model = "gpt-4o-mini" } = body;

  // Generate template ID
  const contentHash = await hashString(
    JSON.stringify({ system_prompt: SUMMARIZATION_SYSTEM_PROMPT }),
  );
  const templateId = `reading-summarize-${TEMPLATE_VERSION}-${contentHash.slice(0, 8)}`;

  // Check if already cached
  const existingTemplate = await env.CACHE?.get(`template:${templateId}`);
  if (existingTemplate) {
    ctx.waitUntil(incrementCacheStats(env, "reading_template_hits"));

    return jsonResponse(
      {
        template_id: templateId,
        already_cached: true,
        token_estimate: Math.ceil(SUMMARIZATION_SYSTEM_PROMPT.length / 4),
        message: "Reading templates already initialized",
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  // Store summarization template
  const template = {
    template_id: templateId,
    template_name: "reading-summarize",
    version: TEMPLATE_VERSION,
    system_prompt: SUMMARIZATION_SYSTEM_PROMPT,
    tools: [],
    provider,
    model,
    created_at: new Date().toISOString(),
    token_estimate: Math.ceil(SUMMARIZATION_SYSTEM_PROMPT.length / 4),
    mode: "reading",
    style_prompts: SUMMARIZATION_PROMPTS,
  };

  if (env.CACHE) {
    await env.CACHE.put(`template:${templateId}`, JSON.stringify(template), {
      expirationTtl: TEMPLATE_TTL,
    });

    // Store as "latest" for easy lookup
    await env.CACHE.put("template:reading-summarize:latest", templateId, {
      expirationTtl: TEMPLATE_TTL,
    });

    ctx.waitUntil(incrementCacheStats(env, "reading_template_misses"));
  }

  console.log(`[Reading Template] Initialized: ${templateId}`);

  return jsonResponse(
    {
      template_id: templateId,
      already_cached: false,
      token_estimate: Math.ceil(SUMMARIZATION_SYSTEM_PROMPT.length / 4),
      message: "Reading templates initialized for fast summarization",
      available_styles: Object.keys(SUMMARIZATION_PROMPTS),
      latency_ms: Date.now() - startTime,
    },
    corsHeaders,
  );
}

/**
 * Handle reading summarization.
 *
 * Uses semantic caching for summarization - similar texts may return
 * cached summaries, providing 30-50% cost reduction.
 *
 * POST /api/reading/summarize
 * {
 *   "text": "Long article content...",
 *   "style": "brief" | "detailed" | "key_points",
 *   "provider": "openai",  // Optional
 *   "model": "gpt-4o-mini" // Optional
 * }
 *
 * Response:
 * {
 *   "summary": "Summarized content...",
 *   "style": "brief",
 *   "cached": true/false,
 *   "original_word_count": 1500,
 *   "summary_word_count": 50
 * }
 */
async function handleReadingSummarize(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    text,
    style = "brief",
    provider = "openai",
    model = "gpt-4o-mini",
    temperature = 0.3, // Low for consistent summaries (enables caching)
  } = body;

  if (!text || !text.trim()) {
    return jsonResponse({ error: "text required" }, corsHeaders, 400);
  }

  const trimmedText = text.trim();
  const stylePrompt = SUMMARIZATION_PROMPTS[style] || SUMMARIZATION_PROMPTS.brief;

  // ===== CACHE CHECK =====
  // Generate cache key from text hash + style
  const textHash = await hashString(`${style}:${trimmedText.slice(0, 2000)}`); // First 2000 chars for key
  const cacheKey = `reading:summarize:${model}:${textHash.slice(0, 32)}`;

  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      ctx.waitUntil(incrementCacheStats(env, "reading_summarize_hits"));

      const cachedData = JSON.parse(cached);
      return jsonResponse(
        {
          ...cachedData,
          cached: true,
          cache_key: textHash.slice(0, 8),
          latency_ms: Date.now() - startTime,
        },
        corsHeaders,
      );
    }
  }

  // ===== LOAD TEMPLATE =====
  let systemPrompt = SUMMARIZATION_SYSTEM_PROMPT;
  let templateUsed = null;

  const templateId = await env.CACHE?.get("template:reading-summarize:latest");
  if (templateId) {
    const template = await env.CACHE.get(`template:${templateId}`, { type: "json" });
    if (template?.system_prompt) {
      systemPrompt = template.system_prompt;
      templateUsed = templateId;
    }
  }

  // ===== CALL LLM =====
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `${stylePrompt}\n\n${trimmedText}` },
  ];

  let response;
  try {
    if (provider === "workers-ai") {
      response = await callWorkersAI(env, messages, model);
    } else {
      response = await callExternalProvider(
        provider,
        messages,
        model,
        temperature,
        1000, // Max tokens for summary
        null,
        null,
        env,
      );
    }
  } catch (error) {
    console.error("Reading summarize LLM error:", error);
    return jsonResponse(
      {
        success: false,
        error: "Summarization failed",
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  const summary = response?.choices?.[0]?.message?.content?.trim();
  const latency = Date.now() - startTime;

  if (!summary) {
    return jsonResponse(
      {
        success: false,
        error: "No summary generated",
        latency_ms: latency,
      },
      corsHeaders,
    );
  }

  const originalWordCount = trimmedText.split(/\s+/).length;
  const summaryWordCount = summary.split(/\s+/).length;

  const result = {
    success: true,
    summary,
    style,
    original_word_count: originalWordCount,
    summary_word_count: summaryWordCount,
    compression_ratio: Math.round((1 - summaryWordCount / originalWordCount) * 100) + "%",
  };

  // ===== CACHE RESULT =====
  // Cache for 4 hours (summaries are very cacheable with low temp)
  if (env.CACHE) {
    await env.CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 14400, // 4 hours
    });
    ctx.waitUntil(incrementCacheStats(env, "reading_summarize_misses"));
  }

  console.log(
    `[Reading Summarize] ${originalWordCount} words -> ${summaryWordCount} words (${style}, ${latency}ms)`,
  );

  return jsonResponse(
    {
      ...result,
      cached: false,
      template_used: templateUsed,
      provider,
      model,
      gateway_cache: response?._gateway?.cacheStatus || "unknown",
      latency_ms: latency,
    },
    corsHeaders,
  );
}

/**
 * Handle vision-based text extraction for reading.
 *
 * Uses GPT-4o to extract readable text from screenshots/images.
 * Routes through AI Gateway for analytics and rate limiting.
 *
 * POST /api/reading/vision
 * {
 *   "screenshot_base64": "...",
 *   "user_request": "read this article",
 *   "app_name": "Safari",
 *   "window_title": "Article Title"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "text": "Extracted text...",
 *   "title": "Article Title",
 *   "source": "vision"
 * }
 */
async function handleReadingVision(request, env, ctx, corsHeaders, startTime) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
  }

  const body = await request.json();
  const {
    screenshot_base64,
    user_request = "read this to me",
    app_name = "Unknown",
    window_title = "Unknown",
    provider = "openai",
    model = "gpt-4o",
  } = body;

  if (!screenshot_base64) {
    return jsonResponse(
      {
        success: false,
        error: "screenshot_base64 required",
        source: "vision",
      },
      corsHeaders,
      400,
    );
  }

  // Build vision prompt
  const prompt = `The user said: "${user_request}"

Looking at this screen, identify the main content the user wants read aloud.

Context:
- App: ${app_name}
- Window: ${window_title}

Instructions:
1. Identify the main content area (article, email body, document, etc.)
2. Ignore navigation, ads, sidebars, and UI elements
3. Extract the text that should be read
4. Format it cleanly for text-to-speech

Return ONLY the text to be read, nothing else. If you cannot identify readable content, respond with "NO_CONTENT_FOUND".`;

  // ===== CALL LLM (Vision) =====
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${screenshot_base64}`,
          },
        },
      ],
    },
  ];

  let response;
  try {
    // Vision requires OpenAI provider
    response = await callExternalProvider(
      "openai",
      messages,
      model,
      0.3, // Low temp for consistent extraction
      4000, // Max tokens for long articles
      null,
      null,
      env,
    );
  } catch (error) {
    console.error("Reading vision LLM error:", error);
    return jsonResponse(
      {
        success: false,
        error: "Vision extraction failed: " + error.message,
        source: "vision",
        latency_ms: Date.now() - startTime,
      },
      corsHeaders,
    );
  }

  const extractedText = response?.choices?.[0]?.message?.content?.trim();
  const latency = Date.now() - startTime;

  if (!extractedText || extractedText === "NO_CONTENT_FOUND") {
    ctx.waitUntil(incrementCacheStats(env, "reading_vision_failures"));

    return jsonResponse(
      {
        success: false,
        error: "Could not identify readable content in screenshot",
        source: "vision",
        latency_ms: latency,
      },
      corsHeaders,
    );
  }

  ctx.waitUntil(incrementCacheStats(env, "reading_vision_successes"));

  console.log(
    `[Reading Vision] Extracted ${extractedText.split(/\s+/).length} words from ${app_name} (${latency}ms)`,
  );

  return jsonResponse(
    {
      success: true,
      text: extractedText,
      title: window_title,
      source: "vision",
      word_count: extractedText.split(/\s+/).length,
      provider,
      model,
      gateway_cache: response?._gateway?.cacheStatus || "unknown",
      latency_ms: latency,
    },
    corsHeaders,
  );
}
