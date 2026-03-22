import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { StorageAdapter } from '../db/index.js';
import { requirePermission } from '../auth/middleware.js';
import { toastHtml, escapeHtml } from './admin/helpers.js';
import { getFixSuggestion, FIX_SUGGESTIONS } from '../fix-suggestions.js';
import { hasPermission } from '../permissions.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateRepoBody {
  readonly siteUrlPattern: string;
  readonly repoUrl: string;
  readonly repoPath?: string;
  readonly branch?: string;
  readonly _csrf?: string;
}

interface ReportFixParams {
  readonly id: string;
}

interface ReportFixIssue {
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly wcagCriterion?: string;
  readonly wcagTitle?: string;
}

interface ReportFixPage {
  readonly url: string;
  readonly issues: readonly ReportFixIssue[];
}

interface JsonReportForFixes {
  readonly pages?: readonly ReportFixPage[];
  readonly issues?: readonly ReportFixIssue[];
  readonly siteUrl?: string;
  readonly templateIssues?: ReadonlyArray<ReportFixIssue & {
    readonly affectedPages: readonly string[];
    readonly affectedCount: number;
  }>;
}

interface FixProposalView {
  readonly index: number;
  readonly file: string | null;
  readonly line: number;
  readonly criterion: string;
  readonly title: string;
  readonly description: string;
  readonly codeExample: string;
  readonly effort: string;
  readonly severity: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly confidence: string;
  readonly pageUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // Only allow http/https URLs and LIKE patterns
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.includes('%')) {
    return trimmed;
  }
  return '';
}

function sanitizeGitUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // Allow https:// and git@ URLs
  if (trimmed.startsWith('https://') || trimmed.startsWith('git@') || trimmed.startsWith('ssh://')) {
    return trimmed;
  }
  return '';
}

function sanitizePath(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const trimmed = raw.trim();
  // Basic path traversal prevention
  if (trimmed.includes('..') || trimmed.includes('\0')) return undefined;
  return trimmed;
}

function sanitizeBranch(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return 'main';
  const trimmed = raw.trim();
  // Allow alphanumeric, hyphens, underscores, slashes, dots
  if (/^[a-zA-Z0-9._\-/]+$/.test(trimmed)) return trimmed;
  return 'main';
}

function collectIssuesFromReport(raw: JsonReportForFixes, siteUrl: string): Array<ReportFixIssue & { pageUrl: string }> {
  const issues: Array<ReportFixIssue & { pageUrl: string }> = [];

  if (raw.pages !== undefined) {
    for (const page of raw.pages) {
      for (const issue of page.issues) {
        issues.push({ ...issue, pageUrl: page.url });
      }
    }
  } else if (raw.issues !== undefined) {
    for (const issue of raw.issues) {
      issues.push({ ...issue, pageUrl: siteUrl });
    }
  }

  // Also include template issues
  if (raw.templateIssues !== undefined) {
    for (const ti of raw.templateIssues) {
      issues.push({
        type: ti.type,
        code: ti.code,
        message: ti.message,
        selector: ti.selector,
        context: ti.context,
        wcagCriterion: ti.wcagCriterion,
        wcagTitle: ti.wcagTitle,
        pageUrl: ti.affectedPages[0] ?? siteUrl,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function repoRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {

  // ── GET /admin/repos — list connected repos (admin only) ──────────────

  server.get(
    '/admin/repos',
    { preHandler: requirePermission('repos.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const repos = await storage.repos.listRepos(orgId);

      return reply.view('repos.hbs', {
        pageTitle: 'Connected Repositories',
        currentPath: '/admin/repos',
        user: request.user,
        repos,
      });
    },
  );

  // ── POST /admin/repos — create connection (admin only) ────────────────

  server.post(
    '/admin/repos',
    { preHandler: requirePermission('repos.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as CreateRepoBody;
      const orgId = request.user?.currentOrgId ?? 'system';
      const username = request.user?.username ?? 'unknown';

      const siteUrlPattern = sanitizeUrl(body.siteUrlPattern);
      const repoUrl = sanitizeGitUrl(body.repoUrl);

      if (siteUrlPattern === '') {
        if (request.headers['hx-request'] === 'true') {
          return reply.code(422).send(toastHtml('Invalid site URL pattern', 'error'));
        }
        return reply.code(422).send({ error: 'Invalid site URL pattern' });
      }

      if (repoUrl === '') {
        if (request.headers['hx-request'] === 'true') {
          return reply.code(422).send(toastHtml('Invalid repository URL', 'error'));
        }
        return reply.code(422).send({ error: 'Invalid repository URL' });
      }

      const repoPath = sanitizePath(body.repoPath);
      const branch = sanitizeBranch(body.branch);

      const repo = await storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern,
        repoUrl,
        repoPath,
        branch,
        createdBy: username,
        orgId,
      });

      if (request.headers['hx-request'] === 'true') {
        // Return the new row + a toast for HTMX
        const repos = await storage.repos.listRepos(orgId);
        return reply.view('repos.hbs', {
          pageTitle: 'Connected Repositories',
          currentPath: '/admin/repos',
          user: request.user,
          repos,
        });
      }

      await reply.redirect('/admin/repos');
    },
  );

  // ── DELETE /admin/repos/:id — remove connection (admin only) ──────────

  server.delete(
    '/admin/repos/:id',
    { preHandler: requirePermission('repos.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const repo = await storage.repos.getRepo(id);

      if (repo === null) {
        return reply.code(404).send({ error: 'Repository connection not found' });
      }

      await storage.repos.deleteRepo(id);

      if (request.headers['hx-request'] === 'true') {
        return reply.code(200).send(
          toastHtml('Repository disconnected', 'success'),
        );
      }

      await reply.redirect('/admin/repos');
    },
  );

  // ── GET /reports/:id/fixes — propose fixes for a scan ─────────────────

  server.get(
    '/reports/:id/fixes',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Only users with issues.fix permission can view fix proposals
      if (!hasPermission(request, 'issues.fix')) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }

      const { id } = request.params as ReportFixParams;
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Find connected repo for this site
      const connectedRepo = await storage.repos.findRepoForUrl(scan.siteUrl, orgId);

      // If no report data, show empty state
      if (
        scan.status !== 'completed' ||
        scan.jsonReportPath === undefined ||
        !existsSync(scan.jsonReportPath)
      ) {
        return reply.view('fixes.hbs', {
          pageTitle: `Fix Proposals — ${scan.siteUrl}`,
          currentPath: `/reports/${id}/fixes`,
          user: request.user,
          scan: {
            ...scan,
            jurisdictions: scan.jurisdictions.join(', '),
          },
          fixes: [],
          fixCount: 0,
          connectedRepo,
          noReport: true,
        });
      }

      // Read and parse the report
      let raw: JsonReportForFixes;
      try {
        raw = JSON.parse(
          await readFile(scan.jsonReportPath, 'utf-8'),
        ) as JsonReportForFixes;
      } catch {
        return reply.view('fixes.hbs', {
          pageTitle: `Fix Proposals — ${scan.siteUrl}`,
          currentPath: `/reports/${id}/fixes`,
          user: request.user,
          scan: {
            ...scan,
            jurisdictions: scan.jurisdictions.join(', '),
          },
          fixes: [],
          fixCount: 0,
          connectedRepo,
          noReport: true,
        });
      }

      // Collect all issues and generate fix proposals using fix-suggestions
      const allIssues = collectIssuesFromReport(raw, scan.siteUrl);
      const fixes: FixProposalView[] = [];
      let fixIndex = 0;

      // Track seen fingerprints for dedup
      const seen = new Set<string>();

      for (const issue of allIssues) {
        const criterion = issue.wcagCriterion ?? '';
        const suggestion = getFixSuggestion(criterion, issue.message);

        if (suggestion === null) continue;

        const fingerprint = `${suggestion.criterion}:${suggestion.issuePattern}:${issue.selector}`;
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);

        fixes.push({
          index: fixIndex++,
          file: connectedRepo?.repoPath ?? null,
          line: 0,
          criterion: suggestion.criterion,
          title: suggestion.title,
          description: suggestion.description,
          codeExample: suggestion.codeExample,
          effort: suggestion.effort,
          severity: issue.type,
          message: issue.message,
          selector: issue.selector,
          context: issue.context,
          confidence: connectedRepo !== null ? 'medium' : 'suggestion',
          pageUrl: issue.pageUrl,
        });
      }

      // Sort: errors first, then by criterion
      fixes.sort((a, b) => {
        const severityOrder: Record<string, number> = { error: 0, warning: 1, notice: 2 };
        const aSev = severityOrder[a.severity] ?? 3;
        const bSev = severityOrder[b.severity] ?? 3;
        if (aSev !== bSev) return aSev - bSev;
        return a.criterion.localeCompare(b.criterion);
      });

      // Group by file/criterion for display
      const groupMap = new Map<string, {
        criterion: string;
        title: string;
        fixes: FixProposalView[];
      }>();

      for (const fix of fixes) {
        const key = fix.criterion;
        const existing = groupMap.get(key);
        if (existing !== undefined) {
          existing.fixes.push(fix);
        } else {
          groupMap.set(key, {
            criterion: fix.criterion,
            title: fix.title,
            fixes: [fix],
          });
        }
      }

      const fixGroups = [...groupMap.values()];

      return reply.view('fixes.hbs', {
        pageTitle: `Fix Proposals — ${scan.siteUrl}`,
        currentPath: `/reports/${id}/fixes`,
        user: request.user,
        scan: {
          ...scan,
          jurisdictions: scan.jurisdictions.join(', '),
        },
        fixes,
        fixCount: fixes.length,
        fixGroups,
        connectedRepo,
        noReport: false,
      });
    },
  );
}
