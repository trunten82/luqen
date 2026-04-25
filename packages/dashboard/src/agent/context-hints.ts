/**
 * Phase 33-02 — Context hints (AGENT-04).
 *
 * Collects the authenticated user's most-recent scans and active brand
 * guidelines so the agent can reference them in responses without the user
 * pasting URLs or IDs. Injected into the system prompt at runTurn time.
 *
 * Org-scoping rules:
 *   - orgId is a real org id  → fetch scoped to that org
 *   - orgId === ''            → unwrapped global admin (admin.system) — cross-org
 *
 * Failure rule: if any individual fetch throws, that slot returns an empty
 * list. Never propagate an error to the caller — context hints are a
 * best-effort enrichment, not a correctness gate.
 */
import type { StorageAdapter } from '../db/index.js';

export const RECENT_SCANS_CAP = 5;
export const ACTIVE_BRANDS_CAP = 10;

export interface ContextScanHint {
  readonly id: string;
  readonly siteUrl: string;
  readonly status: string;
  readonly totalIssues: number;
  readonly detectedAt: string;
}

export interface ContextBrandHint {
  readonly id: string;
  readonly name: string;
}

export interface ContextHints {
  readonly recentScans: readonly ContextScanHint[];
  readonly activeBrands: readonly ContextBrandHint[];
  readonly orgIdentity: { readonly id: string; readonly name: string } | null;
}

export interface CollectHintsInput {
  readonly userId: string;
  readonly orgId: string; // '' signifies cross-org (admin.system)
}

export async function fetchRecentScans(
  storage: StorageAdapter,
  orgId: string,
): Promise<readonly ContextScanHint[]> {
  try {
    const filters = orgId.length > 0 ? { orgId, limit: RECENT_SCANS_CAP } : { limit: RECENT_SCANS_CAP };
    const rows = await storage.scans.listScans(filters);
    return rows.slice(0, RECENT_SCANS_CAP).map((r) => ({
      id: r.id,
      siteUrl: r.siteUrl,
      status: r.status,
      totalIssues: r.totalIssues ?? 0,
      detectedAt: r.createdAt,
    }));
  } catch {
    return [];
  }
}

export async function fetchActiveBrands(
  storage: StorageAdapter,
  orgId: string,
): Promise<readonly ContextBrandHint[]> {
  try {
    if (orgId.length === 0) {
      // Cross-org mode: the branding repository is org-keyed today, so we
      // cannot return a cross-org list without changing its interface.
      // Emit empty — dashboard admins can still ask for specific orgs.
      return [];
    }
    const rows = await storage.branding.listGuidelines(orgId);
    return rows.slice(0, ACTIVE_BRANDS_CAP).map((r) => ({
      id: r.id,
      name: r.name,
    }));
  } catch {
    return [];
  }
}

export async function collectContextHints(
  storage: StorageAdapter,
  input: CollectHintsInput,
): Promise<ContextHints> {
  const [recentScans, activeBrands, orgIdentity] = await Promise.all([
    fetchRecentScans(storage, input.orgId),
    fetchActiveBrands(storage, input.orgId),
    fetchOrgIdentity(storage, input.orgId),
  ]);
  return { recentScans, activeBrands, orgIdentity };
}

async function fetchOrgIdentity(
  storage: StorageAdapter,
  orgId: string,
): Promise<{ id: string; name: string } | null> {
  if (orgId.length === 0) return null;
  try {
    const org = await storage.organizations.getOrg(orgId);
    return org !== null ? { id: org.id, name: org.name } : null;
  } catch {
    return null;
  }
}

export function formatContextHints(h: ContextHints): string {
  const lines: string[] = [
    'Context (read-only — reference only when relevant to the user\'s question):',
  ];

  if (h.orgIdentity !== null) {
    lines.push(`Active org: ${h.orgIdentity.name} (id=${h.orgIdentity.id})`);
  } else {
    lines.push('Active org: (cross-org admin context — no specific org selected)');
  }

  lines.push('Recent scans:');
  if (h.recentScans.length === 0) {
    lines.push('  - (none)');
  } else {
    for (const s of h.recentScans) {
      lines.push(
        `  - [${s.id}] ${s.siteUrl} — status=${s.status}, issues=${s.totalIssues}, at ${s.detectedAt}`,
      );
    }
  }

  lines.push('Active brand guidelines:');
  if (h.activeBrands.length === 0) {
    lines.push('  - (none)');
  } else {
    for (const b of h.activeBrands) {
      lines.push(`  - [${b.id}] ${b.name}`);
    }
  }

  return lines.join('\n');
}
