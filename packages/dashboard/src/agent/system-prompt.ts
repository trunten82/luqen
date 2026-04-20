/**
 * Phase 32 Plan 04 — per-org agent display-name resolver.
 *
 * D-14: the ONLY per-org agent knob. The prompt template itself lives in
 * `@luqen/llm` (`packages/llm/src/prompts/agent-system.ts`) and is shared
 * across all orgs — only the `{agentDisplayName}` interpolation is
 * org-specific, and the sanitiser in `@luqen/llm` treats any HTML-like
 * character as untrusted (T-32-02-03 defence-in-depth).
 *
 * This module is a thin wrapper around `storage.organizations.getOrg`
 * that returns the agent display name with the project-wide fallback
 * applied. Exists so AgentService never has to null-check the org row,
 * handle whitespace, or decide the default copy ("Luqen Assistant").
 */

import type { StorageAdapter } from '../db/index.js';

export async function resolveAgentDisplayName(
  storage: StorageAdapter,
  orgId: string,
  fallback: string,
): Promise<string> {
  const org = await storage.organizations.getOrg(orgId);
  const raw = org?.agentDisplayName;
  if (raw === undefined || raw === null) return fallback;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}
