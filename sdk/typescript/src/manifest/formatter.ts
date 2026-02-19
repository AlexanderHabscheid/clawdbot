/**
 * Centris Manifest Formatter
 *
 * Formats manifest data for LLM consumption. Two modes:
 *
 * 1. Index format: compact summary of ALL loaded manifests (~30 tokens each)
 *    -> injected into system prompt so the LLM knows what's pre-mapped
 *
 * 2. Resolved format: full landmarks + action recipes for a matched URL
 *    -> injected into navigate/click tool results when URL matches a manifest
 *
 * The LLM decides how to use the context  - no separate routing call.
 */

import type { ManifestIndexEntry, ResolvedManifest, ManifestActionStep } from "./types.js";

/**
 * Format the manifest index for system prompt injection.
 * The LLM sees this at the start of every conversation to know
 * which sites have pre-mapped UI knowledge.
 *
 * Output: ~30-50 tokens per manifest.
 */
export function formatManifestIndex(entries: ManifestIndexEntry[]): string {
  if (entries.length === 0) {
    return "";
  }

  const lines: string[] = [
    "## Pre-mapped Sites",
    "These sites have pre-mapped UI  - you already know what to click.",
    "When navigating to a pre-mapped site, use the landmarks and action recipes from the tool result instead of discovering elements through snapshots.",
    "",
  ];

  for (const entry of entries) {
    const actions = entry.actions.length > 0 ? ` | actions: ${entry.actions.join(", ")}` : "";
    const desc = entry.description ? `  - ${entry.description}` : "";
    lines.push(`- **${entry.app}**${desc} (${entry.url_patterns.join(", ")}${actions})`);
  }

  return lines.join("\n");
}

/**
 * Format a resolved manifest for tool result injection.
 * This gets appended to the navigate/click response when the URL
 * matches a loaded manifest.
 *
 * Token budget: ~150-300 tokens depending on complexity.
 */
export function formatResolvedManifest(resolved: ResolvedManifest): string {
  const lines: string[] = [];
  lines.push(`[Pre-mapped: ${resolved.app}]`);

  // Landmarks
  const landmarkEntries = Object.entries(resolved.landmarks);
  if (landmarkEntries.length > 0) {
    lines.push("Landmarks:");
    for (const [name, lm] of landmarkEntries) {
      const desc = lm.description ? `  - ${lm.description}` : "";
      const sel = lm.selectors[0] ?? "";
      lines.push(`  ${name}: ${sel} (${lm.role})${desc}`);
    }
  }

  // Action recipes
  const actionEntries = Object.entries(resolved.actions);
  if (actionEntries.length > 0) {
    lines.push("Actions:");
    for (const [name, action] of actionEntries) {
      const params = action.params?.length ? `(${action.params.join(", ")})` : "";
      const confidence =
        typeof action.confidence === "number"
          ? ` [confidence=${action.confidence.toFixed(2)}]`
          : "";
      lines.push(`  ${name}${params}: ${action.description}${confidence}`);
      for (const step of action.steps) {
        lines.push(`    ${formatStep(step)}`);
      }
      if (action.successChecks?.length) {
        lines.push(`    verify: ${action.successChecks.map((check) => check.type).join(", ")}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Format a resolved manifest as a JSON-like structure for tool result injection.
 * More compact than the text format, better for structured tool results.
 */
export function formatResolvedManifestJson(resolved: ResolvedManifest): Record<string, unknown> {
  const result: Record<string, unknown> = {
    _premapped: resolved.app,
  };

  const landmarkEntries = Object.entries(resolved.landmarks);
  if (landmarkEntries.length > 0) {
    const landmarks: Record<string, { sel: string; role: string; desc?: string }> = {};
    for (const [name, lm] of landmarkEntries) {
      const primarySelector = lm.selectors[0] ?? "";
      landmarks[name] = {
        sel: primarySelector,
        role: lm.role,
        ...(lm.description ? { desc: lm.description } : {}),
      };
    }
    result.landmarks = landmarks;
  }

  const actionEntries = Object.entries(resolved.actions);
  if (actionEntries.length > 0) {
    const actions: Record<
      string,
      {
        desc: string;
        params?: string[];
        steps: string[];
        confidence?: number;
        lastVerifiedAt?: string;
        checks?: string[];
      }
    > = {};
    for (const [name, action] of actionEntries) {
      actions[name] = {
        desc: action.description,
        ...(action.params?.length ? { params: action.params } : {}),
        steps: action.steps.map(formatStep),
        ...(typeof action.confidence === "number" ? { confidence: action.confidence } : {}),
        ...(action.lastVerifiedAt ? { lastVerifiedAt: action.lastVerifiedAt } : {}),
        ...(action.successChecks?.length
          ? { checks: action.successChecks.map((check) => check.type) }
          : {}),
      };
    }
    result.actions = actions;
  }

  return result;
}

function formatStep(step: ManifestActionStep): string {
  if ("click" in step) {
    return `click: ${step.click}`;
  }
  if ("type" in step) {
    return `type "${step.type.value}" into ${step.type.target}`;
  }
  if ("press" in step) {
    return `press: ${step.press}`;
  }
  if ("navigate" in step) {
    return `navigate: ${step.navigate}`;
  }
  if ("wait" in step) {
    return `wait: ${step.wait}ms`;
  }
  if ("scroll" in step) {
    return `scroll: ${step.scroll}${step.amount ? ` ${step.amount}px` : ""}`;
  }
  return JSON.stringify(step);
}
