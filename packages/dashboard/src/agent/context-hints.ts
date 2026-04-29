/**
 * Phase 33-02 — Context hints (AGENT-04).
 *
 * Collects the authenticated user's most-recent scans and active brand
 * guidelines so the agent can reference them in responses without the user
 * pasting URLs or IDs. Injected into the system prompt at runTurn time.
 *
 * Phase 44 Plan 01 (AGENT-04 expansion) — additionally surfaces:
 *   - Recent pending update proposals  (`buildProposalsSection`)
 *   - Org-scoped jurisdictions          (`buildJurisdictionSection`)
 *   - Active regulations (org+system)   (`buildRegulationsSection`)
 *   - Role/permission hints             (`buildRoleHintsSection`)
 *
 * The new sections are PURE helpers exported from this module so callers
 * (agent-service today, MCP server later) can opt in by passing the relevant
 * compliance access + permissions Set into `collectContextHints`. When those
 * inputs are absent the helpers do nothing — preserving the original
 * scans+brands behaviour and keeping per-turn cost unchanged.
 *
 * Org-scoping rules:
 *   - orgId is a real org id  → fetch scoped to that org
 *   - orgId === ''            → unwrapped global admin (admin.system) — cross-org
 *
 * Failure rule: if any individual fetch throws, that slot returns an empty
 * list / null. Never propagate an error to the caller — context hints are a
 * best-effort enrichment, not a correctness gate.
 */
import type { StorageAdapter } from '../db/index.js';
import {
  listJurisdictions,
  listRegulations,
  listUpdateProposals,
  type Jurisdiction,
  type Regulation,
  type UpdateProposal,
} from '../compliance-client.js';
import { formatRoleHints } from './permission-labels.js';

export const RECENT_SCANS_CAP = 5;
export const ACTIVE_BRANDS_CAP = 10;
export const RECENT_PROPOSALS_CAP = 5;
export const ACTIVE_REGULATIONS_CAP = 10;
export const ORG_JURISDICTIONS_CAP = 5;

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

export interface ContextProposalHint {
  readonly id: string;
  readonly type: string;
  readonly summary: string;
  readonly detectedAt: string;
}

export interface ContextJurisdictionHint {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly iso3166?: string;
}

export interface ContextRegulationHint {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export interface ContextHints {
  readonly recentScans: readonly ContextScanHint[];
  readonly activeBrands: readonly ContextBrandHint[];
  readonly orgIdentity: { readonly id: string; readonly name: string } | null;
  /** Phase 44: pending update proposals awaiting org action (max 5). */
  readonly proposals: readonly ContextProposalHint[];
  /** Phase 44: org-defined jurisdictions (max 5). Empty when org has none. */
  readonly jurisdictions: readonly ContextJurisdictionHint[];
  /** Phase 44: active regulations visible to the org (max 10). */
  readonly regulations: readonly ContextRegulationHint[];
  /** Phase 44: pre-formatted role hint string, or null when no curated permissions match. */
  readonly roleHints: string | null;
}

/**
 * Per-call compliance access factory — returns the live compliance baseUrl
 * and bearer token, or null when the compliance service is not configured.
 * Mirrors the same shape used by MCP tool registration in server.ts so the
 * agent + MCP paths share one contract.
 */
export type ComplianceAccess = () => Promise<{
  readonly baseUrl: string;
  readonly token: string;
} | null>;

export interface CollectHintsInput {
  readonly userId: string;
  readonly orgId: string; // '' signifies cross-org (admin.system)
  /** Phase 44: opt-in compliance fetch for proposals/regs/jurisdictions. */
  readonly complianceAccess?: ComplianceAccess;
  /** Phase 44: caller's effective permissions for role-hint rendering. */
  readonly permissions?: ReadonlySet<string>;
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

/**
 * Phase 44: recent pending update proposals (max 5). Returns null on fetch
 * error or when no compliance access is configured. Returns [] (not null)
 * when the call succeeds but the org has nothing pending — caller treats
 * empty + null identically (omits the section).
 */
export async function buildProposalsSection(
  orgId: string,
  complianceAccess: ComplianceAccess | undefined,
): Promise<readonly ContextProposalHint[] | null> {
  if (complianceAccess === undefined) return null;
  try {
    const access = await complianceAccess();
    if (access === null) return null;
    // status='pending' — only proposals awaiting acknowledge/approve/reject
    // are actionable from the agent's perspective.
    const rows = await listUpdateProposals(
      access.baseUrl,
      access.token,
      'pending',
      orgId.length > 0 ? orgId : undefined,
    );
    return rows.slice(0, RECENT_PROPOSALS_CAP).map((p: UpdateProposal) => ({
      id: p.id,
      type: p.type,
      summary: p.summary,
      detectedAt: p.detectedAt,
    }));
  } catch {
    return null;
  }
}

/**
 * Phase 44: jurisdictions whose `orgId` matches the caller's org. System-
 * seeded jurisdictions are intentionally excluded — the agent already has
 * dashboard_list_jurisdictions to enumerate the global set; the context block
 * only needs to flag *org-defined* jurisdictions because those are the ones
 * the user is actively curating.
 *
 * Returns null on error or when no compliance access is configured. Returns
 * [] when the org has no custom jurisdictions — caller omits the section.
 */
export async function buildJurisdictionSection(
  orgId: string,
  complianceAccess: ComplianceAccess | undefined,
): Promise<readonly ContextJurisdictionHint[] | null> {
  if (complianceAccess === undefined) return null;
  if (orgId.length === 0) return null;
  try {
    const access = await complianceAccess();
    if (access === null) return null;
    const rows = await listJurisdictions(access.baseUrl, access.token, orgId);
    const orgRows = rows.filter((j: Jurisdiction) => j.orgId === orgId);
    return orgRows.slice(0, ORG_JURISDICTIONS_CAP).map((j) => ({
      id: j.id,
      name: j.name,
      type: j.type,
      iso3166: j.iso3166,
    }));
  } catch {
    return null;
  }
}

/**
 * Phase 44: active regulations visible to the org (org-scoped + system-seeded
 * union, capped at 10). Filters out regulations whose status is not 'active'
 * or 'in-force' so retired/superseded regs don't bloat the prompt.
 *
 * Returns null on error or when no compliance access is configured.
 */
export async function buildRegulationsSection(
  orgId: string,
  complianceAccess: ComplianceAccess | undefined,
): Promise<readonly ContextRegulationHint[] | null> {
  if (complianceAccess === undefined) return null;
  try {
    const access = await complianceAccess();
    if (access === null) return null;
    const rows = await listRegulations(
      access.baseUrl,
      access.token,
      undefined,
      orgId.length > 0 ? orgId : undefined,
    );
    const active = rows.filter((r: Regulation) => {
      const s = r.status.toLowerCase();
      return s === 'active' || s === 'in-force' || s === 'in_force' || s === 'enforced';
    });
    return active.slice(0, ACTIVE_REGULATIONS_CAP).map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
    }));
  } catch {
    return null;
  }
}

/**
 * Phase 44: role hints — pure mapping over the caller's permissions Set.
 * Returns null when no curated permissions match (caller omits section).
 */
export function buildRoleHintsSection(
  perms: ReadonlySet<string> | undefined,
): string | null {
  if (perms === undefined) return null;
  return formatRoleHints(perms);
}

export async function collectContextHints(
  storage: StorageAdapter,
  input: CollectHintsInput,
): Promise<ContextHints> {
  // Run scans + brands + org identity (Phase 33) and the four Phase 44
  // sections in parallel. Each helper internally swallows errors so this
  // Promise.all never rejects.
  const [
    recentScans,
    activeBrands,
    orgIdentity,
    proposals,
    jurisdictions,
    regulations,
  ] = await Promise.all([
    fetchRecentScans(storage, input.orgId),
    fetchActiveBrands(storage, input.orgId),
    fetchOrgIdentity(storage, input.orgId),
    buildProposalsSection(input.orgId, input.complianceAccess),
    buildJurisdictionSection(input.orgId, input.complianceAccess),
    buildRegulationsSection(input.orgId, input.complianceAccess),
  ]);
  const roleHints = buildRoleHintsSection(input.permissions);
  return {
    recentScans,
    activeBrands,
    orgIdentity,
    proposals: proposals ?? [],
    jurisdictions: jurisdictions ?? [],
    regulations: regulations ?? [],
    roleHints,
  };
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
    lines.push(
      `The user's currently active organization is "${h.orgIdentity.name}" ` +
      `(org_id=${h.orgIdentity.id}). When the user asks which org they are in, ` +
      `answer with this organization name. "Luqen" is the platform name, NOT the org.`,
    );
  } else {
    lines.push(
      'No specific organization is currently active (cross-org admin context). ' +
      'When asked which org the user is in, say no org is currently selected and ' +
      'offer to list available orgs.',
    );
  }

  // Recent scans summary — DO NOT emit scan IDs here. The model will latch
  // onto any UUID in its prompt context and cite it as "the scan ID" when
  // asked, even when those scans are unrelated to the current turn (root
  // cause of agent-uat-residuals bug 1: stale scan IDs from prior sessions
  // leaked through this hint and got reported as "the scan I just ran").
  // The model must obtain real scan IDs only from tool results
  // (dashboard_scan_site, dashboard_list_reports). Hints only signal that
  // recent scans EXIST so the model can offer to list/fetch them.
  lines.push('Recent scans (summary only — call dashboard_list_reports for IDs):');
  if (h.recentScans.length === 0) {
    lines.push('  - (none)');
  } else {
    for (const s of h.recentScans) {
      lines.push(
        `  - ${s.siteUrl} — status=${s.status}, issues=${s.totalIssues}`,
      );
    }
  }

  // Active brand guidelines — same rationale: do not emit IDs. The model
  // calls dashboard_list_brand_scores / dashboard_get_brand_score when an
  // ID is actually required.
  lines.push('Active brand guidelines (names only — call brand tools for IDs):');
  if (h.activeBrands.length === 0) {
    lines.push('  - (none)');
  } else {
    for (const b of h.activeBrands) {
      lines.push(`  - ${b.name}`);
    }
  }

  // ── Phase 44 sections ──────────────────────────────────────────────────
  // Each section is rendered ONLY when it carries data. Empty arrays render
  // nothing (no orphan heading) — keeps the prompt token-cheap when the
  // compliance service is not wired (e.g. local dev) or the org has no
  // pending proposals/jurisdictions/regulations.

  if (h.proposals.length > 0) {
    lines.push('');
    lines.push('Recent proposals awaiting your action (call dashboard_list_proposals for full detail):');
    for (const p of h.proposals) {
      lines.push(`  - [${p.id}] ${p.type} — ${p.summary} (detected ${p.detectedAt})`);
    }
  }

  if (h.jurisdictions.length > 0) {
    lines.push('');
    lines.push('Org-defined jurisdictions:');
    for (const j of h.jurisdictions) {
      const iso = j.iso3166 !== undefined && j.iso3166.length > 0 ? ` ${j.iso3166}` : '';
      lines.push(`  - ${j.name} (${j.type}${iso})`);
    }
  }

  if (h.regulations.length > 0) {
    lines.push('');
    lines.push('Active regulations (call dashboard_list_regulations for filters/IDs):');
    for (const r of h.regulations) {
      lines.push(`  - ${r.name} (status=${r.status})`);
    }
  }

  if (h.roleHints !== null && h.roleHints.length > 0) {
    lines.push('');
    lines.push(`Your role hints — you can: ${h.roleHints}.`);
  }

  return lines.join('\n');
}
