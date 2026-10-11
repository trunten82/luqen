/**
 * Org-scope guards for the GraphQL resolvers. Each helper copies the org rule
 * of the REST route that serves the same resource, so GraphQL can never reach
 * a record REST would refuse. One predicate per resource type.
 *
 * Out-of-org reads resolve exactly as missing records (null). Mutations refuse
 * with the error that REST's status code stands for.
 */
import { bypassesOrgScope } from '../permissions.js';
import type {
  ScanRecord, IssueAssignment, BrandingGuidelineRecord, Team,
} from '../db/index.js';
import type { GraphQLContext } from './resolvers.js';

// ── Scans ────────────────────────────────────────────────────────────────

/**
 * Read rule of GET /api/v1/scans/:id and /:id/issues (routes/api/data.ts):
 * `scan === null || scan.orgId !== orgId` → 404. No admin bypass.
 */
export async function getScanInOrg(ctx: GraphQLContext, id: string): Promise<ScanRecord | null> {
  const scan = await ctx.storage.scans.getScan(id);
  if (scan === null || scan === undefined || scan.orgId !== ctx.orgId) return null;
  return scan;
}

/**
 * Rule of DELETE /api/v1/scans/:id (routes/api/data.ts): missing → 404;
 * `!bypassesOrgScope(user) && scan.orgId !== orgId` → 403. A global admin may
 * delete any org's scan.
 */
export async function getScanForDelete(ctx: GraphQLContext, id: string): Promise<ScanRecord> {
  const scan = await ctx.storage.scans.getScan(id);
  if (scan === null || scan === undefined) throw new Error(`Scan not found: ${id}`);
  if (!bypassesOrgScope(ctx.user) && scan.orgId !== ctx.orgId) throw new Error('Forbidden');
  return scan;
}

// ── Assignments (routes/assignments.ts) ─────────────────────────────────

/**
 * routes/assignments.ts treats a record as visible when the caller is a global
 * admin, or the record's org is the caller's current org or 'system'.
 * Anything else answers 404, as if it did not exist.
 */
function assignmentScopeAllows(ctx: GraphQLContext, ownerOrgId: string | undefined): boolean {
  return bypassesOrgScope(ctx.user) || ownerOrgId === ctx.orgId || ownerOrgId === 'system';
}

/** Scan rule of POST /reports/:id/assign (create assignment) → "not found" when out of scope. */
export async function getScanForAssignment(ctx: GraphQLContext, scanId: string): Promise<ScanRecord> {
  const scan = await ctx.storage.scans.getScan(scanId);
  if (scan === null || scan === undefined || !assignmentScopeAllows(ctx, scan.orgId)) {
    throw new Error(`Scan not found: ${scanId}`);
  }
  return scan;
}

/** Rule of PATCH/DELETE /assignments/:id → "not found" when out of scope. */
export async function getAssignmentInOrg(ctx: GraphQLContext, id: string): Promise<IssueAssignment> {
  const assignment = await ctx.storage.assignments.getAssignment(id);
  if (assignment === null || assignment === undefined || !assignmentScopeAllows(ctx, assignment.orgId)) {
    throw new Error(`Assignment not found: ${id}`);
  }
  return assignment;
}

// ── Teams (routes/admin/teams.ts canMutateTeam) ────────────────────────

/** Global admin sees any team; anyone else only teams of their current org. */
export async function getTeamInOrg(ctx: GraphQLContext, id: string): Promise<Team | null> {
  const team = await ctx.storage.teams.getTeam(id);
  if (team === null || team === undefined) return null;
  if (!bypassesOrgScope(ctx.user) && team.orgId !== ctx.orgId) return null;
  return team;
}

// ── Branding (routes/api/branding.ts) ───────────────────────────────────

/** `guideline === null || guideline.orgId !== orgId` → 404. No admin bypass. */
export async function getGuidelineInOrg(
  ctx: GraphQLContext,
  id: string,
): Promise<BrandingGuidelineRecord | null> {
  const guideline = await ctx.storage.branding.getGuideline(id);
  if (guideline === null || guideline === undefined || guideline.orgId !== ctx.orgId) return null;
  return guideline;
}

/** Mutation form of getGuidelineInOrg: refuses with REST's 404 message. */
export async function requireGuidelineInOrg(
  ctx: GraphQLContext,
  id: string,
): Promise<BrandingGuidelineRecord> {
  const guideline = await getGuidelineInOrg(ctx, id);
  if (guideline === null) throw new Error('Guideline not found');
  return guideline;
}

export type BrandChildKind = 'color' | 'font' | 'selector';

const CHILD_LABEL: Record<BrandChildKind, string> = { color: 'Color', font: 'Font', selector: 'Selector' };

/**
 * GraphQL addresses a color/font/selector by its own id, where REST addresses
 * it under its guideline. Resolve the child among the caller org's guidelines
 * (the same set getGuidelineInOrg admits); a child outside them is refused
 * exactly as a missing one.
 */
export async function requireBrandChildInOrg(
  ctx: GraphQLContext,
  kind: BrandChildKind,
  childId: string,
): Promise<void> {
  const guidelines = await ctx.storage.branding.listGuidelines(ctx.orgId);
  for (const g of guidelines) {
    if (g.orgId !== ctx.orgId) continue;
    const children = kind === 'color'
      ? await ctx.storage.branding.listColors(g.id)
      : kind === 'font'
        ? await ctx.storage.branding.listFonts(g.id)
        : await ctx.storage.branding.listSelectors(g.id);
    if (children.some((c) => c.id === childId)) return;
  }
  throw new Error(`${CHILD_LABEL[kind]} not found`);
}
