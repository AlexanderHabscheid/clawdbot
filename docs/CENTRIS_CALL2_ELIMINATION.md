# Centris Token Optimization: Call 2 Elimination

**Date:** 2026-02-16  
**Status:** Implemented & verified  
**Affected files:**

- `src/agents/centris-router.ts` — detection logic (`detectSingleToolDone`)
- `src/agents/pi-embedded-runner/run/attempt.ts` — `streamFn` wrapper

---

## 1. Problem Statement

Every Centris agent request (file write, exec, computer control) was making **two** LLM API calls through Cloudflare AI Gateway:

| Call | Input Tokens | Output Tokens | Cost       | Purpose                              |
| ---- | ------------ | ------------- | ---------- | ------------------------------------ |
| 1    | ~2,330       | ~30           | ~$0.000245 | LLM decides which tool to call       |
| 2    | ~2,390       | **0**         | ~$0.000239 | LLM says "I'm done" (empty response) |

Call 2 burned **~2,400 input tokens for zero output**. For every simple task (write a file, run a command, list apps), half the token budget was wasted on a call that returned nothing.

### Cloudflare Evidence (before fix)

```
Feb 16, 2026 9:13:14 PM  gemini-2.5-flash-lite  2386 in  –   out  $~0.00023860  918ms
Feb 16, 2026 9:13:13 PM  gemini-2.5-flash-lite  2327 in  30  out  $~0.00024470  892ms

Feb 16, 2026 9:12:31 PM  gemini-2.5-flash-lite  2386 in  –   out  $~0.00023860  364ms
Feb 16, 2026 9:12:31 PM  gemini-2.5-flash-lite  2327 in  30  out  $~0.00024470  792ms

Feb 16, 2026 9:10:44 PM  gemini-2.5-flash-lite  2386 in  –   out  $~0.00023860  373ms
Feb 16, 2026 9:10:44 PM  gemini-2.5-flash-lite  2327 in  30  out  $~0.00024470  640ms
```

Every pair: one useful call + one wasted call. Consistent pattern across all test runs.

---

## 2. Root Cause Analysis

### The pi-agent-core Agent Loop

The `agentLoop` in `@mariozechner/pi-agent-core` (`dist/agent-loop.js`) runs a `while` loop:

```
hasMoreToolCalls = true;  // initialized to true

while (hasMoreToolCalls || pendingMessages.length > 0) {
    // CALL 1: Ask LLM what to do
    message = streamAssistantResponse(...)    // → 2327 in, 30 out

    toolCalls = message.content.filter(c => c.type === "toolCall");
    hasMoreToolCalls = toolCalls.length > 0;  // true (found 1 tool call)

    if (hasMoreToolCalls) {
        executeToolCalls(...)  // tool runs successfully
    }

    // while condition: hasMoreToolCalls=true → loop continues

    // CALL 2: Ask LLM "any more tools?"
    message = streamAssistantResponse(...)    // → 2386 in, 0 out (nothing)

    toolCalls = message.content.filter(c => c.type === "toolCall");
    hasMoreToolCalls = toolCalls.length > 0;  // false (no more tools)

    // while condition: hasMoreToolCalls=false → loop exits
}
```

The loop **cannot** know the task is done after tool execution. It must ask the LLM. For simple single-tool tasks, the LLM always answers "nothing" — an empty response. The library provides no `shouldContinue` hook or early-exit mechanism.

### Why This Matters at Scale

| Scenario                          | Calls Before | Calls After | Token Savings        |
| --------------------------------- | ------------ | ----------- | -------------------- |
| Single file write                 | 2            | 1           | ~50% (~2,400 tokens) |
| Single exec command               | 2            | 1           | ~50%                 |
| Single computer action            | 2            | 1           | ~50%                 |
| Multi-step browser flow (5 steps) | 10           | 5–9\*       | 10–50%\*             |

\*Browser flows are more complex — see Section 5 for the plan.

---

## 3. Solution: streamFn Wrapper

Instead of modifying the library, we wrap the `streamFn` (the function that makes the actual LLM API call). When we detect a completed single-tool task, we return a **synthetic "done" response** instead of calling the API. The loop sees no tool calls, exits cleanly, and zero tokens are sent.

### Architecture

```
┌─────────────────────────────────────────────────┐
│  pi-agent-core agentLoop                        │
│                                                 │
│  Call 1: streamFn(model, context, opts)          │
│          ↓ (real API call → tool decision)       │
│          Tool executes                           │
│                                                 │
│  Call 2: streamFn(model, context, opts)          │
│          ↓                                      │
│  ┌──────────────────────────────────────┐       │
│  │  Centris streamFn wrapper            │       │
│  │                                      │       │
│  │  detectSingleToolDone(context.msgs)  │       │
│  │    → 1 toolResult, not error,        │       │
│  │      tool in SKIP_CALL2_TOOLS,       │       │
│  │      1 tool call in assistant msg    │       │
│  │                                      │       │
│  │  YES → return synthetic stream       │       │
│  │         (0 tokens, "Done." text)     │       │
│  │                                      │       │
│  │  NO  → call real API (originalFn)    │       │
│  └──────────────────────────────────────┘       │
│                                                 │
│  Loop: no tool calls → exit                     │
└─────────────────────────────────────────────────┘
```

### Detection Logic (`centris-router.ts`)

```typescript
const SKIP_CALL2_TOOLS = new Set(["write", "edit", "apply_patch", "exec", "centris_computer"]);

function detectSingleToolDone(messages): string | null {
  // 1. Exactly 1 toolResult in the context
  // 2. Not an error
  // 3. Tool name is in SKIP_CALL2_TOOLS
  // 4. Assistant had exactly 1 tool call (not a multi-tool plan)
  // → return "Done." (or null to skip)
}
```

### streamFn Wrapper (`attempt.ts`)

The wrapper intercepts the `streamFn` call, checks the context, and either:

- Returns a synthetic `AssistantMessageEventStream` with a "done" event (zero tokens)
- Passes through to the original `streamFn` (full API call)

The synthetic response uses `createAssistantMessageEventStream()` from `@mariozechner/pi-ai` to ensure type compatibility with the agent loop's event processing.

---

## 4. Test Results

### Before Fix (Cloudflare)

```
Per simple task: 2 API calls, ~4,700 input tokens, ~$0.000484
```

### After Fix (Live Test)

```
$ pnpm openclaw agent --agent main --thinking off --json \
    --message "Write a file to /tmp/centris-final-test.txt with the content 'one call only'"

[centris-router] domain=file → 5 tools (read, edit, write, exec, tts)
[centris-budget] domain=file prompt=~1245tok tools=5×~866tok total=~2111tok
[centris-router] cleared 65 old messages (clean slate for new command)
[centris-call2-skip] single-tool done: write → skipping Call 2

payloads: [{ "text": "Done." }]
durationMs: 4265
Call 1 usage: { input: 2328, output: 31 }
Call 2 usage: { input: 0, output: 0, total: 0 }  ← ELIMINATED
```

| Metric             | Before         | After          | Improvement |
| ------------------ | -------------- | -------------- | ----------- |
| API calls per task | 2              | 1              | **-50%**    |
| Total input tokens | ~4,700         | ~2,328         | **-50.5%**  |
| Cost per task      | ~$0.000484     | ~$0.000245     | **-49.4%**  |
| Latency            | ~1.8s LLM time | ~0.9s LLM time | **-50%**    |

### Existing Tests

All 60 centris tests pass (router, integration, context pruning, tool policy):

```
Test Files  2 passed (2)
     Tests  60 passed (60)
  Duration  192ms
```

### Domain Routing (verified working)

| Test Message                             | Routed Domain | Tools Loaded                                    |
| ---------------------------------------- | ------------- | ----------------------------------------------- |
| "Write a file to /tmp/test.txt"          | file          | 5 (read, edit, write, exec, tts)                |
| "Get a snapshot of the frontmost window" | computer      | 2 (centris_computer, tts)                       |
| "Navigate to google.com"                 | browser       | 4 (centris_browser, web_search, web_fetch, tts) |
| "List currently running applications"    | computer      | 2 (centris_computer, tts)                       |

### What Is NOT Short-Circuited (by design)

| Scenario                        | Why                                                           |
| ------------------------------- | ------------------------------------------------------------- |
| Tool errors (`isError: true`)   | LLM should explain what went wrong                            |
| Multi-tool plans (>1 tool call) | LLM may need intermediate results to plan next steps          |
| `read` tool                     | Content needs LLM summarization/presentation                  |
| `centris_browser`               | Multi-step flows need LLM to plan next action (see Section 5) |
| `web_search` / `web_fetch`      | Results need LLM interpretation                               |

---

## 5. Browser Agent — Call 2 Elimination Plan

The browser agent is fundamentally different from file/exec/computer agents because it's **multi-step by design**: navigate → snapshot → click → type → click. Each step needs the LLM to decide the next action based on the DOM snapshot.

### 5a. Current Browser Flow (typical 3-step task)

```
"Go to google.com and search for 'weather'"

Call 1: LLM → centris_browser(action="navigate", url="google.com")    [useful]
Call 2: LLM sees DOM snapshot → centris_browser(action="click", nodeId=42)  [useful]
Call 3: LLM sees post-click DOM → centris_browser(action="type", text="weather")  [useful]
Call 4: LLM sees result → "I searched for weather on Google"           [WASTEFUL]
```

Call 4 is the same pattern: the LLM sees the final tool result and produces a "done" response. For browser flows, the LAST call in the chain (after the final tool succeeds) is the wasteful one.

### 5b. Strategy: Skip Call 2 for Terminal Browser Actions

Not all browser actions need follow-up. Some are **terminal** — they complete the user's request:

| Action              | Terminal? | Why                                                                 |
| ------------------- | --------- | ------------------------------------------------------------------- |
| `navigate`          | NO        | Need to see the page to act on it                                   |
| `snapshot`          | NO        | Need LLM to interpret elements                                      |
| `click`             | SOMETIMES | If clicking was the final step (e.g., "click the submit button")    |
| `type`              | SOMETIMES | If typing was the final step (e.g., "type hello in the search box") |
| `scroll`            | NO        | User usually wants to see what's visible after scrolling            |
| `press_key` (Enter) | SOMETIMES | Enter often submits → could be terminal                             |
| `tabs`              | NO        | LLM needs to interpret tab list                                     |
| `read_page`         | NO        | LLM needs to summarize content                                      |

### 5c. Implementation Plan

**Phase 1: Simple terminal detection (low risk)**

Add `centris_browser` to `SKIP_CALL2_TOOLS`, but only when the browser action is the LAST in a multi-step flow and it's a terminal action. This requires checking:

1. The `centris_browser` tool result includes the action type
2. The action is terminal (click/type/press_key as final step)
3. The user's original request has been fully addressed

This is harder than file/exec because "fully addressed" requires semantic understanding. Possible heuristic: if the tool result indicates the action succeeded AND there's only one remaining step in the user's original request.

**Phase 2: Response caching for known patterns**

For common browser patterns (navigate → click → type → enter), predefine response templates:

```
navigate(google.com) + type("weather") + press_key("Enter")
→ "Done. Searched for 'weather' on Google."
```

This would skip Call 2 for the final step of recognized multi-step patterns.

**Phase 3: Context window optimization (already implemented)**

The existing `compactCentrisContext` already handles the browser's multi-step token growth:

- Old DOM snapshots are compressed to 1-line summaries
- Only the latest snapshot is kept in full
- Context stays flat (~4,400 tokens) instead of growing linearly

This means the browser's Call 2 cost per step is already minimized. The main savings opportunity is eliminating the FINAL Call 2 in the chain.

### 5d. Estimated Browser Savings

| Flow                            | Steps | Calls Before | Calls After (Phase 1)                | Savings |
| ------------------------------- | ----- | ------------ | ------------------------------------ | ------- |
| Navigate only                   | 1     | 2            | 2 (can't skip — need interpretation) | 0%      |
| Navigate + click                | 2     | 4            | 3                                    | 25%     |
| Navigate + click + type         | 3     | 6            | 5                                    | 17%     |
| Navigate + click + type + enter | 4     | 8            | 7                                    | 12.5%   |

The savings per step decrease as complexity increases, but for voice-assistant use cases where most browser tasks are 2-3 steps, this is meaningful.

### 5e. Risk Assessment

| Risk                                                           | Mitigation                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Skip too aggressively → user gets "Done." but page isn't ready | Only skip for click/type/press_key that report `success: true`    |
| Multi-tool plan gets skipped                                   | Already guarded: skip only when assistant had exactly 1 tool call |
| Browser error not explained                                    | Already guarded: `isError` check prevents skip                    |
| Page navigation needs interpretation                           | `navigate` is NOT in the terminal action list                     |

---

## 6. Token Optimization Stack (Complete)

All three layers work together to keep Centris token-efficient:

| Layer                                                | What It Does                                       | When It Runs         | Savings                             |
| ---------------------------------------------------- | -------------------------------------------------- | -------------------- | ----------------------------------- |
| **Domain routing**                                   | Narrows tools to domain-specific set               | Before Call 1        | ~60-85% fewer tool schema tokens    |
| **Context pruning** (`compactCentrisContext`)        | Compresses old tool results, strips thinking       | Before each LLM call | Keeps context flat vs linear growth |
| **Inter-command clearing** (`compactStaleSnapshots`) | Wipes all history between voice commands           | Between commands     | 100% history cleanup                |
| **Call 2 elimination** (NEW)                         | Skips wasted second API call for single-tool tasks | At streamFn level    | ~50% fewer tokens per simple task   |

### Combined Effect (single file-write task)

```
Without optimizations:  ~8,000+ input tokens across 2 calls (full tools + full context)
With all optimizations:  ~2,328 input tokens in 1 call

Total savings: ~71%
```

---

## 7. Files Changed

### `src/agents/centris-router.ts`

- Added `detectSingleToolDone()` — checks if LLM messages contain a completed single-tool result
- Added `SKIP_CALL2_TOOLS` set — tools whose results don't need LLM interpretation
- Earlier session: Added weighted keywords to `COMPUTER_KEYWORDS` for better desktop routing

### `src/agents/pi-embedded-runner/run/attempt.ts`

- Added `streamFn` wrapper inside the `centrisProfile === "centris"` block
- Wrapper calls `detectSingleToolDone()` on the LLM context before each API call
- If detected, returns a synthetic `AssistantMessageEventStream` with `stopReason: "stop"` and text `"Done."`
- If not detected, passes through to the original `streamFn` (full API call)
