/**
 * GraphQL resolvers for the Luqen dashboard.
 *
 * Each resolver pulls DB instances and permissions from the Mercurius context.
 * Permission checks mirror the REST API guards defined in auth/middleware.ts.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { StorageAdapter, ScanRecord } from '../db/index.js';
import { VERSION } from '../version.js';
import { validatePassword, validateUsername } from '../validation.js';
import { validateScanUrl, VALID_STANDARDS } from '../services/scan-service.js';
import { retagScansForSite } from '../services/branding-retag.js';

// ---------------------------------------------------------------------------
// Context typing
// ---------------------------------------------------------------------------

export interface GraphQLContext {
  readonly storage: StorageAdapter;
  readonly user: { id: string; username: string; role: string } | undefined;
  readonly permissions: Set<string>;
  readonly orgId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireAuth(ctx: GraphQLContext): void {
  if (ctx.user === undefined) {
    throw new Error('Authentication required');
  }
}

function requirePerm(ctx: GraphQLContext, ...perms: readonly string[]): void {
  requireAuth(ctx);
  const hasAny = perms.some((p) => ctx.permissions.has(p));
  if (!hasAny) {
    throw new Error(`Forbidden: requires ${perms.join(' or ')}`);
  }
}

function clamp(value: number | undefined | null, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

interface PageInfo {
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasNextPage: boolean;
}

function buildPageInfo(totalCount: number, limit: number, offset: number): PageInfo {
  return {
    totalCount,
    limit,
    offset,
    hasNextPage: offset + limit < totalCount,
  };
}

// Issue types from the JSON report
interface ReportIssue {
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly selector: string;
  readonly context?: string;
  readonly wcagCriterion?: string;
  readonly wcagTitle?: string;
}

interface ReportPage {
  readonly url: string;
  readonly issues: readonly ReportIssue[];
}

interface JsonReport {
  readonly pages?: readonly ReportPage[];
}

async function readReport(reportPath: string | undefined): Promise<JsonReport | null> {
  if (reportPath === undefined || !existsSync(reportPath)) {
    return null;
  }
  try {
    const raw = await readFile(reportPath, 'utf-8');
    return JSON.parse(raw) as JsonReport;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export const resolvers = {
  Query: {
    // ── Scans ──────────────────────────────────────────────────────────

    scans: async (
      _root: unknown,
      args: { siteUrl?: string; from?: string; to?: string; limit?: number; offset?: number },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const limit = clamp(args.limit, 1, 1000, 100);
      const offset = clamp(args.offset, 0, Number.MAX_SAFE_INTEGER, 0);

      const allScans = await ctx.storage.scans.listScans({
        siteUrl: args.siteUrl ?? undefined,
        orgId: ctx.orgId,
      });

      // Apply date filters in memory (listScans doesn't support date range natively)
      let filtered = allScans;
      if (args.from !== undefined) {
        filtered = filtered.filter((s) => s.createdAt >= args.from!);
      }
      if (args.to !== undefined) {
        filtered = filtered.filter((s) => s.createdAt <= args.to!);
      }

      const totalCount = filtered.length;
      const nodes = filtered.slice(offset, offset + limit);

      return {
        nodes,
        totalCount,
        pageInfo: buildPageInfo(totalCount, limit, offset),
      };
    },

    scan: async (
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return await ctx.storage.scans.getScan(args.id) ?? null;
    },

    // ── Issues ─────────────────────────────────────────────────────────

    scanIssues: async (
      _root: unknown,
      args: { scanId: string; severity?: string; criterion?: string; limit?: number; offset?: number },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const scan = await ctx.storage.scans.getScan(args.scanId);
      if (scan === null) {
        return { nodes: [], totalCount: 0, pageInfo: buildPageInfo(0, 0, 0) };
      }

      const report = await readReport(scan.jsonReportPath);
      if (report === null || report.pages === undefined) {
        return { nodes: [], totalCount: 0, pageInfo: buildPageInfo(0, 0, 0) };
      }

      // Flatten all issues across pages
      let issues: Array<ReportIssue & { pageUrl: string }> = [];
      for (const page of report.pages) {
        for (const issue of page.issues) {
          issues.push({ ...issue, pageUrl: page.url });
        }
      }

      // Filter by severity
      if (args.severity !== undefined) {
        issues = issues.filter((i) => i.type === args.severity);
      }

      // Filter by WCAG criterion
      if (args.criterion !== undefined) {
        issues = issues.filter((i) => i.wcagCriterion === args.criterion);
      }

      const totalCount = issues.length;
      const limit = clamp(args.limit, 1, 1000, 100);
      const offset = clamp(args.offset, 0, Number.MAX_SAFE_INTEGER, 0);
      const nodes = issues.slice(offset, offset + limit);

      return {
        nodes,
        totalCount,
        pageInfo: buildPageInfo(totalCount, limit, offset),
      };
    },

    // ── Assignments ────────────────────────────────────────────────────

    assignments: async (
      _root: unknown,
      args: { scanId?: string; status?: string; assignedTo?: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      return await ctx.storage.assignments.listAssignments({
        scanId: args.scanId ?? undefined,
        status: args.status as 'open' | 'assigned' | 'in-progress' | 'fixed' | 'verified' | undefined,
        assignedTo: args.assignedTo ?? undefined,
        orgId: ctx.orgId,
      });
    },

    // ── Trends ─────────────────────────────────────────────────────────

    trends: async (
      _root: unknown,
      args: { siteUrl: string },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'trends.view');

      const allCompleted = await ctx.storage.scans.getTrendData(ctx.orgId);
      const matching = allCompleted.filter((s) => s.siteUrl === args.siteUrl);

      return matching.map((s) => ({
        scanId: s.id,
        siteUrl: s.siteUrl,
        completedAt: s.completedAt ?? s.createdAt,
        totalIssues: s.totalIssues ?? 0,
        errors: s.errors ?? 0,
        warnings: s.warnings ?? 0,
        notices: s.notices ?? 0,
      }));
    },

    // ── Compliance summary ─────────────────────────────────────────────

    complianceSummary: async (
      _root: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const allCompleted = await ctx.storage.scans.getTrendData(ctx.orgId);

      // Group by site URL and take the latest scan for each
      const bySite = new Map<string, ScanRecord>();
      for (const scan of allCompleted) {
        const existing = bySite.get(scan.siteUrl);
        if (existing === undefined || scan.createdAt > existing.createdAt) {
          bySite.set(scan.siteUrl, scan);
        }
      }

      return [...bySite.values()].map((s) => ({
        siteUrl: s.siteUrl,
        latestScanId: s.id,
        totalIssues: s.totalIssues ?? 0,
        errors: s.errors ?? 0,
        warnings: s.warnings ?? 0,
        notices: s.notices ?? 0,
        completedAt: s.completedAt ?? s.createdAt,
      }));
    },

    // ── Users ──────────────────────────────────────────────────────────

    dashboardUsers: async (
      _root: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'users.create', 'users.delete', 'users.activate', 'users.reset_password', 'users.roles');
      return await ctx.storage.users.listUsers();
    },

    // ── Teams ──────────────────────────────────────────────────────────

    teams: async (
      _root: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return await ctx.storage.teams.listTeams(ctx.orgId);
    },

    team: async (
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return await ctx.storage.teams.getTeam(args.id) ?? null;
    },

    // ── Organizations ──────────────────────────────────────────────────

    organizations: async (
      _root: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return await ctx.storage.organizations.listOrgs();
    },

    // ── Roles ──────────────────────────────────────────────────────────

    roles: async (
      _root: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return await ctx.storage.roles.listRoles(ctx.orgId);
    },

    // ── Audit log ──────────────────────────────────────────────────────

    auditLog: async (
      _root: unknown,
      args: { actor?: string; action?: string; resourceType?: string; from?: string; to?: string; limit?: number; offset?: number },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'audit.view');

      const limit = clamp(args.limit, 1, 200, 50);
      const offset = clamp(args.offset, 0, Number.MAX_SAFE_INTEGER, 0);

      const result = await ctx.storage.audit.query({
        actor: args.actor,
        action: args.action,
        resourceType: args.resourceType,
        from: args.from,
        to: args.to,
        orgId: ctx.orgId,
        limit,
        offset,
      });

      return {
        nodes: result.entries,
        totalCount: result.total,
        pageInfo: buildPageInfo(result.total, limit, offset),
      };
    },

    // ── System ─────────────────────────────────────────────────────────

    health: () => ({
      status: 'ok',
      version: VERSION,
    }),

    // ── Branding ─────────────────────────────────────────────────────

    async brandingGuidelines(_: unknown, _args: unknown, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.view');
      const guidelines = await ctx.storage.branding.listGuidelines(ctx.orgId);
      return Promise.all(guidelines.map(async (g) => ({
        ...g,
        colors: g.colors ?? [],
        fonts: g.fonts ?? [],
        selectors: g.selectors ?? [],
        sites: await ctx.storage.branding.getSiteAssignments(g.id),
      })));
    },

    async brandingGuideline(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.view');
      const g = await ctx.storage.branding.getGuideline(args.id);
      if (!g) return null;
      return {
        ...g,
        colors: g.colors ?? [],
        fonts: g.fonts ?? [],
        selectors: g.selectors ?? [],
        sites: await ctx.storage.branding.getSiteAssignments(g.id),
      };
    },

    async brandingGuidelineForSite(_: unknown, args: { siteUrl: string }, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.view');
      const g = await ctx.storage.branding.getGuidelineForSite(args.siteUrl, ctx.orgId);
      if (!g) return null;
      return {
        ...g,
        colors: g.colors ?? [],
        fonts: g.fonts ?? [],
        selectors: g.selectors ?? [],
        sites: await ctx.storage.branding.getSiteAssignments(g.id),
      };
    },
  },

  Mutation: {
    // ── Scans ──────────────────────────────────────────────────────────

    createScan: async (
      _root: unknown,
      args: { input: { siteUrl: string; standard?: string; jurisdictions?: string[] } },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'scans.create');

      // SSRF protection: validate URL before creating scan
      const urlResult = validateScanUrl(args.input.siteUrl);
      if ('error' in urlResult) {
        throw new Error(urlResult.error);
      }

      // Validate standard
      const standard = args.input.standard ?? 'WCAG2AA';
      if (!(VALID_STANDARDS as readonly string[]).includes(standard)) {
        throw new Error(`standard must be one of: ${VALID_STANDARDS.join(', ')}`);
      }

      const id = randomUUID();
      const now = new Date().toISOString();

      return await ctx.storage.scans.createScan({
        id,
        siteUrl: urlResult.url.toString(),
        standard,
        jurisdictions: args.input.jurisdictions ?? [],
        createdBy: ctx.user!.username,
        createdAt: now,
        orgId: ctx.orgId,
      });
    },

    deleteScan: async (
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'reports.delete');

      const scan = await ctx.storage.scans.getScan(args.id);
      if (scan === null) {
        throw new Error(`Scan not found: ${args.id}`);
      }

      await ctx.storage.scans.deleteScan(args.id);
      return true;
    },

    // ── Assignments ────────────────────────────────────────────────────

    assignIssue: async (
      _root: unknown,
      args: {
        input: {
          scanId: string;
          issueFingerprint: string;
          wcagCriterion?: string;
          wcagTitle?: string;
          severity: string;
          message: string;
          selector?: string;
          pageUrl?: string;
          assignedTo?: string;
          notes?: string;
        };
      },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'issues.assign');

      const id = randomUUID();
      const now = new Date().toISOString();
      return await ctx.storage.assignments.createAssignment({
        id,
        scanId: args.input.scanId,
        issueFingerprint: args.input.issueFingerprint,
        wcagCriterion: args.input.wcagCriterion,
        wcagTitle: args.input.wcagTitle,
        severity: args.input.severity,
        message: args.input.message,
        selector: args.input.selector,
        pageUrl: args.input.pageUrl,
        assignedTo: args.input.assignedTo,
        notes: args.input.notes,
        createdBy: ctx.user!.username,
        createdAt: now,
        updatedAt: now,
        orgId: ctx.orgId,
      });
    },

    updateAssignment: async (
      _root: unknown,
      args: { id: string; status?: string; assignedTo?: string; notes?: string },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'issues.assign');

      const existing = await ctx.storage.assignments.getAssignment(args.id);
      if (existing === null) {
        throw new Error(`Assignment not found: ${args.id}`);
      }

      await ctx.storage.assignments.updateAssignment(args.id, {
        status: args.status as 'open' | 'assigned' | 'in-progress' | 'fixed' | 'verified' | undefined,
        assignedTo: args.assignedTo,
        notes: args.notes,
      });

      const updated = await ctx.storage.assignments.getAssignment(args.id);
      if (updated === null) {
        throw new Error(`Assignment not found after update: ${args.id}`);
      }
      return updated;
    },

    deleteAssignment: async (
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'issues.assign');

      const existing = await ctx.storage.assignments.getAssignment(args.id);
      if (existing === null) {
        throw new Error(`Assignment not found: ${args.id}`);
      }

      await ctx.storage.assignments.deleteAssignment(args.id);
      return true;
    },

    // ── Users ──────────────────────────────────────────────────────────

    createUser: async (
      _root: unknown,
      args: { username: string; password: string; role?: string },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'users.create');
      const usernameCheck = validateUsername(args.username);
      if (!usernameCheck.valid) {
        throw new Error(usernameCheck.error ?? 'Invalid username');
      }
      const passwordCheck = validatePassword(args.password);
      if (!passwordCheck.valid) {
        throw new Error(passwordCheck.error ?? 'Invalid password');
      }
      return await ctx.storage.users.createUser(args.username, args.password, args.role ?? 'user');
    },

    deleteUser: async (
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'users.delete');

      const user = await ctx.storage.users.getUserById(args.id);
      if (user === null) {
        throw new Error(`User not found: ${args.id}`);
      }

      return await ctx.storage.users.deleteUser(args.id);
    },

    activateUser: async (
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'users.activate');

      const user = await ctx.storage.users.getUserById(args.id);
      if (user === null) {
        throw new Error(`User not found: ${args.id}`);
      }

      await ctx.storage.users.activateUser(args.id);

      const updated = await ctx.storage.users.getUserById(args.id);
      if (updated === null) {
        throw new Error(`User not found after activation: ${args.id}`);
      }
      return updated;
    },

    deactivateUser: async (
      _root: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'users.activate');

      const user = await ctx.storage.users.getUserById(args.id);
      if (user === null) {
        throw new Error(`User not found: ${args.id}`);
      }

      await ctx.storage.users.deactivateUser(args.id);

      const updated = await ctx.storage.users.getUserById(args.id);
      if (updated === null) {
        throw new Error(`User not found after deactivation: ${args.id}`);
      }
      return updated;
    },

    resetPassword: async (
      _root: unknown,
      args: { id: string; newPassword: string },
      ctx: GraphQLContext,
    ) => {
      requirePerm(ctx, 'users.reset_password');

      const user = await ctx.storage.users.getUserById(args.id);
      if (user === null) {
        throw new Error(`User not found: ${args.id}`);
      }

      const passwordCheck = validatePassword(args.newPassword);
      if (!passwordCheck.valid) {
        throw new Error(passwordCheck.error ?? 'Invalid password');
      }
      await ctx.storage.users.updatePassword(args.id, args.newPassword);
      return true;
    },

    // ── Branding mutations ─────────────────────────────────────────────

    async createBrandingGuideline(
      _: unknown,
      args: { input: { name: string; description?: string } },
      ctx: GraphQLContext,
    ) {
      requirePerm(ctx, 'branding.manage');
      const guideline = await ctx.storage.branding.createGuideline({
        id: randomUUID(),
        orgId: ctx.orgId,
        name: args.input.name,
        description: args.input.description,
        createdBy: ctx.user?.id,
      });
      return {
        ...guideline,
        colors: guideline.colors ?? [],
        fonts: guideline.fonts ?? [],
        selectors: guideline.selectors ?? [],
        sites: await ctx.storage.branding.getSiteAssignments(guideline.id),
      };
    },

    async deleteBrandingGuideline(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.manage');
      await ctx.storage.branding.deleteGuideline(args.id);
      return true;
    },

    async toggleBrandingGuideline(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.manage');
      const existing = await ctx.storage.branding.getGuideline(args.id);
      if (!existing) throw new Error('Guideline not found');
      const updated = await ctx.storage.branding.updateGuideline(args.id, { active: !existing.active });
      return {
        ...updated,
        colors: updated.colors ?? [],
        fonts: updated.fonts ?? [],
        selectors: updated.selectors ?? [],
        sites: await ctx.storage.branding.getSiteAssignments(updated.id),
      };
    },

    async addBrandColor(
      _: unknown,
      args: { guidelineId: string; input: { name: string; hexValue: string; usage?: string; context?: string } },
      ctx: GraphQLContext,
    ) {
      requirePerm(ctx, 'branding.manage');
      return ctx.storage.branding.addColor(args.guidelineId, {
        id: randomUUID(),
        name: args.input.name,
        hexValue: args.input.hexValue.toUpperCase(),
        ...(args.input.usage ? { usage: args.input.usage } : {}),
        ...(args.input.context ? { context: args.input.context } : {}),
      });
    },

    async removeBrandColor(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.manage');
      await ctx.storage.branding.removeColor(args.id);
      return true;
    },

    async addBrandFont(
      _: unknown,
      args: { guidelineId: string; input: { family: string; weights?: string[]; usage?: string; context?: string } },
      ctx: GraphQLContext,
    ) {
      requirePerm(ctx, 'branding.manage');
      return ctx.storage.branding.addFont(args.guidelineId, {
        id: randomUUID(),
        family: args.input.family,
        ...(args.input.weights ? { weights: args.input.weights } : {}),
        ...(args.input.usage ? { usage: args.input.usage } : {}),
        ...(args.input.context ? { context: args.input.context } : {}),
      });
    },

    async removeBrandFont(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.manage');
      await ctx.storage.branding.removeFont(args.id);
      return true;
    },

    async addBrandSelector(
      _: unknown,
      args: { guidelineId: string; input: { pattern: string; description?: string } },
      ctx: GraphQLContext,
    ) {
      requirePerm(ctx, 'branding.manage');
      return ctx.storage.branding.addSelector(args.guidelineId, {
        id: randomUUID(),
        pattern: args.input.pattern,
        ...(args.input.description ? { description: args.input.description } : {}),
      });
    },

    async removeBrandSelector(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.manage');
      await ctx.storage.branding.removeSelector(args.id);
      return true;
    },

    async assignBrandingToSite(
      _: unknown,
      args: { guidelineId: string; siteUrl: string },
      ctx: GraphQLContext,
    ) {
      requirePerm(ctx, 'branding.manage');
      await ctx.storage.branding.assignToSite(args.guidelineId, args.siteUrl, ctx.orgId);
      // Retag existing scans
      try { await retagScansForSite(ctx.storage, args.siteUrl, ctx.orgId); } catch { /* non-fatal */ }
      return true;
    },

    async unassignBrandingFromSite(_: unknown, args: { siteUrl: string }, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.manage');
      await ctx.storage.branding.unassignFromSite(args.siteUrl, ctx.orgId);
      return true;
    },

    async retagBrandingScans(_: unknown, args: { siteUrl: string }, ctx: GraphQLContext) {
      requirePerm(ctx, 'branding.manage');
      return retagScansForSite(ctx.storage, args.siteUrl, ctx.orgId);
    },
  },
};
