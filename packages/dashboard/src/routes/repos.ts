import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { StorageAdapter } from '../db/index.js';
import type { DashboardConfig } from '../config.js';
import { requirePermission } from '../auth/middleware.js';
import { toastHtml } from './admin/helpers.js';
import { getFixSuggestion } from '../fix-suggestions.js';
import { hasPermission } from '../permissions.js';
import { getGitHostPlugin } from '../git-hosts/registry.js';
import { decryptSecret } from '../plugins/crypto.js';
import { RemoteFileReader } from '../git-hosts/remote-file-reader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateRepoBody {
  readonly siteUrlPattern: string;
  readonly repoUrl: string;
  readonly repoPath?: string;
  readonly branch?: string;
  readonly gitHostConfigId?: string;
  readonly orgId?: string;
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
  if (trimmed.length > 1024) return undefined;
  // Basic path traversal prevention
  if (trimmed.includes('..') || trimmed.includes('\0')) return undefined;
  return trimmed;
}

function sanitizeBranch(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return 'main';
  const trimmed = raw.trim();
  if (trimmed.length > 256) return 'main';
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
  config: DashboardConfig,
): Promise<void> {

  // ── GET /admin/repos — list connected repos (admin only) ──────────────

  server.get(
    '/admin/repos',
    { preHandler: requirePermission('repos.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const isAdmin = request.user?.role === 'admin';
      const currentOrgId = request.user?.currentOrgId ?? 'system';

      // Global admin sees repos for all orgs; org admin sees their own
      const repos = isAdmin
        ? await storage.repos.listRepos()
        : await storage.repos.listRepos(currentOrgId);

      // Git host configs: admin sees all, org user sees their org + system
      const gitHosts = isAdmin
        ? [...await storage.gitHosts.listConfigs('system'), ...await storage.gitHosts.listConfigs(currentOrgId)]
        : await storage.gitHosts.listConfigs(currentOrgId);

      // Org list for the dropdown (admin sees all, org user sees just theirs)
      const orgs = isAdmin
        ? await storage.organizations.listOrgs()
        : (currentOrgId !== 'system' ? [await storage.organizations.getOrg(currentOrgId)].filter(Boolean) : []);

      return reply.view('repos.hbs', {
        pageTitle: 'Connected Repositories',
        currentPath: '/admin/repos',
        user: request.user,
        repos,
        gitHosts,
        orgs,
        currentOrgId,
        isAdmin,
      });
    },
  );

  // ── POST /admin/repos — create connection (admin only) ────────────────

  server.post(
    '/admin/repos',
    { preHandler: requirePermission('repos.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as CreateRepoBody;
      const isAdmin = request.user?.role === 'admin';
      // Global admin can assign to any org via form; org admin uses their own
      const orgId = isAdmin && body.orgId?.trim()
        ? body.orgId.trim()
        : (request.user?.currentOrgId ?? 'system');
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
      const gitHostConfigId = body.gitHostConfigId?.trim() || undefined;

      await storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern,
        repoUrl,
        repoPath,
        branch,
        gitHostConfigId,
        createdBy: username,
        orgId,
      });

      if (request.headers['hx-request'] === 'true') {
        // Return the new row + a toast for HTMX
        const repos = await storage.repos.listRepos(orgId);
        const gitHosts = await storage.gitHosts.listConfigs(orgId);
        return reply.view('repos.hbs', {
          pageTitle: 'Connected Repositories',
          currentPath: '/admin/repos',
          user: request.user,
          repos,
          gitHosts,
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

      // Check if user can create PRs (has credentials for the repo's git host)
      let canCreatePr = false;
      if (
        connectedRepo !== null &&
        connectedRepo.gitHostConfigId !== null &&
        hasPermission(request, 'repos.credentials')
      ) {
        const userId = request.user?.id ?? '';
        const credential = await storage.gitHosts.getCredentialForHost(userId, connectedRepo.gitHostConfigId);
        canCreatePr = credential !== null;
      }

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
          canCreatePr,
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
          canCreatePr,
          noReport: true,
        });
      }

      // Collect all issues for both core proposer and local fallback
      const allIssues = collectIssuesFromReport(raw, scan.siteUrl);

      // Try core's proposeFixesFromReport with RemoteFileReader when git host is available
      let usedCoreProposer = false;
      const fixes: FixProposalView[] = [];

      if (
        connectedRepo !== null &&
        connectedRepo.gitHostConfigId !== null &&
        canCreatePr
      ) {
        try {
          const gitHostConfig = await storage.gitHosts.getConfig(connectedRepo.gitHostConfigId);
          const plugin = gitHostConfig !== null ? getGitHostPlugin(gitHostConfig.pluginType) : undefined;
          const userId = request.user?.id ?? '';
          const credential = connectedRepo.gitHostConfigId !== null
            ? await storage.gitHosts.getCredentialForHost(userId, connectedRepo.gitHostConfigId)
            : null;

          if (gitHostConfig !== null && plugin !== undefined && credential !== null) {
            const token = decryptSecret(credential.encryptedToken, config.sessionSecret);
            const remoteReader = new RemoteFileReader(plugin, {
              hostUrl: gitHostConfig.hostUrl,
              repo: connectedRepo.repoUrl,
              branch: connectedRepo.branch,
              token,
            });

            const { proposeFixesFromReport } = await import('@luqen/core');
            if (proposeFixesFromReport.length >= 4) {
              // Build source map override: map the scanned URL path prefix to repo root
              // e.g. raw.githubusercontent.com/owner/repo/main/index.html → index.html
              const siteUrlBase = connectedRepo.siteUrlPattern.replace(/%$/, '');
              const overrides: Record<string, string> = {};
              try {
                const basePathname = new URL(siteUrlBase).pathname;
                overrides[`${basePathname}/*`] = '';
              } catch { /* use empty overrides */ }

              const proposals = await (proposeFixesFromReport as (
                report: unknown, repoPath: string, overrides: Record<string, string>, reader: RemoteFileReader,
              ) => Promise<{ fixes: ReadonlyArray<{ file: string; line: number; issue: string; description: string; oldText: string; newText: string; confidence: string }> }>)(
                raw, connectedRepo.repoPath ?? '', overrides, remoteReader,
              );

              let fixIndex = 0;
              for (const proposal of proposals.fixes) {
                // Find matching issue for additional metadata
                const matchingIssue = allIssues.find((iss) => iss.selector && proposal.oldText.includes(iss.context));
                fixes.push({
                  index: fixIndex++,
                  file: proposal.file,
                  line: proposal.line,
                  criterion: proposal.issue,
                  title: proposal.description,
                  description: proposal.description,
                  codeExample: `<!-- Before -->\n${proposal.oldText}\n\n<!-- After -->\n${proposal.newText}`,
                  effort: 'low',
                  severity: matchingIssue?.type ?? 'error',
                  message: proposal.description,
                  selector: matchingIssue?.selector ?? '',
                  context: proposal.oldText,
                  confidence: proposal.confidence,
                  pageUrl: matchingIssue?.pageUrl ?? scan.siteUrl,
                });
              }
              usedCoreProposer = true;
            }
          }
        } catch {
          // Core not built with FileReader support yet — fall back to local suggestion engine
        }
      }

      // Fallback: local fix-suggestions engine
      if (!usedCoreProposer) {
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
        canCreatePr,
        noReport: false,
      });
    },
  );
}
