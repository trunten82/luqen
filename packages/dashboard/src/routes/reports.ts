import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorageAdapter } from '../db/index.js';
import { extractCriterion, getWcagDescription } from './wcag-enrichment.js';
import { MANUAL_CRITERIA } from '../manual-criteria.js';
import { normalizeReportData, inferComponent } from '../services/report-service.js';
import type { JsonReportFile } from '../services/report-service.js';
import { getFixSuggestion } from '../fix-suggestions.js';
import type { LLMClient } from '../llm-client.js';
import { t } from '../i18n/index.js';
export { normalizeReportData, inferComponent };
export type { JsonReportFile };

function aiDisclaimer(): string {
  return `<p class="ai-disclaimer text-muted" style="font-size:var(--font-size-xs);margin-top:var(--space-sm);font-style:italic;">${t('common.aiDisclaimer')}</p>`;
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));

interface ReportsQuery {
  q?: string;
  status?: string;
  offset?: string;
  limit?: string;
}

const PAGE_SIZE = 20;


export async function reportRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  llmClient: LLMClient | null = null,
): Promise<void> {
  // GET /reports — list with pagination and search
  server.get(
    '/reports',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as ReportsQuery;
      const offset = query.offset !== undefined ? parseInt(query.offset, 10) : 0;
      const limit = query.limit !== undefined ? Math.min(Math.max(parseInt(query.limit, 10) || PAGE_SIZE, 1), 100) : PAGE_SIZE;
      const q = query.q?.trim();
      const status = query.status;

      // Admin sees all scans (global view for troubleshooting);
      // other users see their org scans + system scans (no org assigned).
      const isAdmin = request.user?.role === 'admin';
      const orgId = request.user?.currentOrgId ?? 'system';
      const scans = await storage.scans.listScans({
        ...(q !== undefined && q !== '' ? { siteUrl: q } : {}),
        ...(status !== undefined && status !== '' && status !== 'all'
          ? { status: status as 'queued' | 'running' | 'completed' | 'failed' }
          : {}),
        ...(!isAdmin ? { orgId } : {}),
        offset,
        limit: limit + 1, // fetch one extra to detect if there's a next page
      });

      const hasNext = scans.length > limit;
      const page = hasNext ? scans.slice(0, limit) : scans;
      const hasPrev = offset > 0;
      const currentPage = Math.floor(offset / limit) + 1;

      // For each completed scan, find the previous completed scan of the same URL
      // to enable "Compare with previous" links
      const formatted = await Promise.all(page.map(async (s) => {
        let previousScanId: string | undefined;
        if (s.status === 'completed') {
          const previousScans = await storage.scans.listScans({
            siteUrl: s.siteUrl,
            status: 'completed',
            limit: 10,
          });
          // listScans returns descending by date; find first one older than current
          const prev = previousScans.find(
            (ps) => ps.id !== s.id && new Date(ps.createdAt) < new Date(s.createdAt),
          );
          if (prev !== undefined) {
            previousScanId = prev.id;
          }
        }
        // Compute compliance traffic light status
        const confirmed = s.confirmedViolations ?? 0;
        const hasJurisdictions = s.jurisdictions.length > 0;
        const complianceStatus = !hasJurisdictions ? 'none'
          : confirmed > 0 ? 'fail'
          : (s.notices ?? 0) > 0 ? 'review'
          : 'pass';

        return {
          ...s,
          jurisdictions: s.jurisdictions.join(', '),
          createdAtDisplay: new Date(s.createdAt).toLocaleString(),
          completedAtDisplay: s.completedAt
            ? new Date(s.completedAt).toLocaleString()
            : '',
          previousScanId,
          complianceStatus,
        };
      }));

      // HTMX partial request — return table fragment only
      const isHtmx = request.headers['hx-request'] === 'true';
      if (isHtmx) {
        return reply.view('partials/reports-table.hbs', {
          scans: formatted,
          user: request.user,
          hasPrev,
          hasNext,
          prevOffset: Math.max(0, offset - limit),
          nextOffset: offset + limit,
          limit,
          currentPage,
          q,
          status,
        });
      }

      return reply.view('reports-list.hbs', {
        pageTitle: 'Reports',
        currentPath: '/reports',
        user: request.user,
        scans: formatted,
        hasPrev,
        hasNext,
        prevOffset: Math.max(0, offset - limit),
        nextOffset: offset + limit,
        limit,
        currentPage,
        q,
        status,
      });
    },
  );

  // GET /reports/:id — read JSON report and render rich report-detail template
  server.get(
    '/reports/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (request.user?.role !== 'admin' && scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const scanMeta = {
        ...scan,
        jurisdictions: scan.jurisdictions.join(', '),
        createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
        completedAtDisplay: scan.completedAt
          ? new Date(scan.completedAt).toLocaleString()
          : '',
      };

      // If scan is not completed, render a status-only view
      if (scan.status !== 'completed') {
        return reply.view('report-detail.hbs', {
          pageTitle: `Report — ${scan.siteUrl}`,
          currentPath: `/reports/${id}`,
          user: request.user,
          scan: scanMeta,
          reportData: null,
          pdfAvailable: true,
          llmEnabled: llmClient !== null,
        });
      }

      // Load report data — try DB first, then filesystem fallback
      let reportData: ReturnType<typeof normalizeReportData> | null = null;
      try {
        const dbReport = await storage.scans.getReport(id);
        if (dbReport !== null) {
          reportData = normalizeReportData(dbReport as JsonReportFile, scan);
        } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
          const raw = JSON.parse(
            await readFile(scan.jsonReportPath, 'utf-8'),
          ) as JsonReportFile;
          reportData = normalizeReportData(raw, scan);
        }
      } catch {
        // Render without report data — template handles the missing case
      }

      if (reportData === null) {
        return reply.view('report-detail.hbs', {
          pageTitle: `Report — ${scan.siteUrl}`,
          currentPath: `/reports/${id}`,
          user: request.user,
          scan: scanMeta,
          reportData: null,
          pdfAvailable: true,
          llmEnabled: llmClient !== null,
        });
      }

      // Compute manual testing completion stats
      const manualResults = await storage.manualTests.getManualTests(id);
      const manualTested = manualResults.filter(
        (r) => r.status === 'pass' || r.status === 'fail' || r.status === 'na',
      ).length;
      const manualTotal = MANUAL_CRITERIA.length;
      const manualPct = manualTotal > 0 ? Math.round((manualTested / manualTotal) * 100) : 0;

      // Compute issue assignment stats + build assigned fingerprint lookup
      const assignmentStats = await storage.assignments.getAssignmentStats(id);
      const assignmentActiveCount = assignmentStats.open + assignmentStats.assigned + assignmentStats.inProgress;
      const allAssignments = await storage.assignments.listAssignments({ scanId: id });
      const assignedMap: Record<string, { id: string; status: string; assignedTo: string | null }> = {};
      for (const a of allAssignments) {
        // Store by exact fingerprint
        assignedMap[a.issueFingerprint] = { id: a.id, status: a.status, assignedTo: a.assignedTo };
        // Also store by wcag_criterion for bulk-assigned items (criterion||bulk||title format)
        if (a.wcagCriterion) {
          assignedMap[`criterion:${a.wcagCriterion}`] = { id: a.id, status: a.status, assignedTo: a.assignedTo };
        }
      }

      // Build assignees list (users + teams) for the assignment picker — org-scoped
      const isAdmin = request.user?.role === 'admin';
      const dashboardUsers = isAdmin
        ? await storage.users.listUsers()
        : orgId !== 'system'
          ? await storage.users.listUsersForOrg(orgId)
          : await storage.users.listUsers();
      const teams = await storage.teams.listTeams(orgId);
      const assignees = [
        ...dashboardUsers.filter((u) => u.active).map((u) => ({ type: 'user', id: u.username, label: u.username })),
        ...teams.map((t) => ({ type: 'team', id: `team:${t.id}`, label: `Team: ${t.name}` })),
      ];

      const brandFilter = (request.query as Record<string, string>).brandFilter ?? 'all';

      // Check if the branding guideline used for this scan is still active
      let brandingGuidelineActive = true;
      if (scan.brandingGuidelineId) {
        try {
          const guideline = await storage.branding.getGuideline(scan.brandingGuidelineId);
          brandingGuidelineActive = guideline?.active ?? false;
        } catch {
          brandingGuidelineActive = false;
        }
      }

      // Compute compliance traffic light from enriched matrix
      const hasCompliance = reportData?.complianceMatrix != null;
      const enrichedFailing = (reportData as any)?.compliance?.summary?.failing ?? 0;
      const enrichedReview = (reportData as any)?.compliance?.summary?.needsReview ?? 0;
      const complianceStatus = !hasCompliance ? 'none'
        : enrichedFailing > 0 ? 'fail'
        : enrichedReview > 0 ? 'review'
        : 'pass';

      return reply.view('report-detail.hbs', {
        pageTitle: `Report — ${scan.siteUrl}`,
        currentPath: `/reports/${id}`,
        user: request.user,
        scan: scanMeta,
        reportData,
        complianceStatus,
        brandFilter,
        brandingGuidelineActive,
        pdfAvailable: true,
        llmEnabled: llmClient !== null,
        manualTestStats: {
          tested: manualTested,
          total: manualTotal,
          percentage: manualPct,
        },
        assignmentStats,
        assignmentActiveCount,
        assignedMap,
        assignees,
      });
    },
  );

  // GET /reports/:id/print — standalone print-friendly HTML for browser print-to-PDF
  server.get(
    '/reports/:id/print',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (request.user?.role !== 'admin' && scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      if (scan.status !== 'completed') {
        return reply.code(404).send({ error: 'Report data not available' });
      }

      let reportData: ReturnType<typeof normalizeReportData> | null = null;
      try {
        const dbReport = await storage.scans.getReport(id);
        if (dbReport !== null) {
          reportData = normalizeReportData(dbReport as JsonReportFile, scan);
        } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
          const raw = JSON.parse(
            await readFile(scan.jsonReportPath, 'utf-8'),
          ) as JsonReportFile;
          reportData = normalizeReportData(raw, scan);
        }
      } catch {
        return reply.code(500).send({ error: 'Failed to read report data' });
      }

      if (reportData === null) {
        return reply.code(404).send({ error: 'Report data not available' });
      }

      const scanMeta = {
        ...scan,
        jurisdictions: scan.jurisdictions.join(', '),
        createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
        completedAtDisplay: scan.completedAt
          ? new Date(scan.completedAt).toLocaleString()
          : '',
      };

      // Compile the print template directly with Handlebars to bypass layout
      const handlebars = (await import('handlebars')).default;
      const viewsDir = resolve(join(__dirname, '..', 'views'));
      const templateSource = await readFile(
        join(viewsDir, 'report-print.hbs'),
        'utf-8',
      );
      const template = handlebars.compile(templateSource);
      const userRole = request.user?.role ?? 'user';
      const perms = (request as unknown as Record<string, unknown>)['permissions'] as Set<string> | undefined ?? new Set<string>();
      const html = template({
        scan: scanMeta,
        reportData,
        userRole,
        isExecutiveView: !perms.has('scans.create') && perms.has('trends.view'),
      });

      return reply.type('text/html').send(html);
    },
  );

  // DELETE /reports/:id — delete scan record and files
  server.delete(
    '/reports/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (request.user?.role !== 'admin' && scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Only users with reports.delete permission can delete (or the creator)
      const user = request.user;
      const permsSet = (request as unknown as Record<string, unknown>)['permissions'] as Set<string> | undefined;
      const canDelete = permsSet?.has('reports.delete') === true || scan.createdBy === user?.username;
      if (!canDelete) {
        return reply.code(403).send({ error: 'You can only delete your own reports' });
      }

      // Delete report files
      if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
        await unlink(scan.jsonReportPath).catch(() => undefined);
      }

      await storage.scans.deleteScan(id);

      // HTMX request — return empty fragment for swap
      if (request.headers['hx-request'] === 'true') {
        return reply.code(200).send('');
      }

      await reply.redirect('/reports');
    },
  );

  // GET /reports/:id/fix-suggestion — HTMX partial: AI fix or hardcoded fallback
  server.get(
    '/reports/:id/fix-suggestion',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        criterion?: string;
        message?: string;
        htmlContext?: string;
        cssContext?: string;
      };

      const criterion = query.criterion ?? '';
      const message = query.message ?? '';
      const htmlContext = query.htmlContext ?? '';
      const cssContext = query.cssContext;

      const esc = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

      const copyBtn = (html: string) =>
        `<button type="button" class="btn btn--sm btn--ghost" aria-label="Copy fix suggestion to clipboard" `
        + `onclick="(function(btn){navigator.clipboard.writeText(${JSON.stringify(html)}).then(function(){`
        + `var t=btn.textContent;btn.textContent='Copied!';setTimeout(function(){btn.textContent=t},1500)`
        + `});})(this)">Copy</button>`;

      // Try LLM first
      let llmFailed = false;
      if (llmClient) {
        try {
          const orgId = request.user?.currentOrgId ?? undefined;
          const result = await llmClient.generateFix({
            wcagCriterion: criterion,
            issueMessage: message,
            htmlContext,
            ...(cssContext ? { cssContext } : {}),
            ...(orgId ? { orgId } : {}),
          });

          if (result.fixedHtml) {
            const html =
              `<pre class="rpt-fix-hint__code"><code>${esc(result.fixedHtml)}</code></pre>`
              + `<p class="rpt-fix-hint__desc">${esc(result.explanation)}</p>`
              + `<div class="rpt-fix-hint__actions">`
              + `<span class="rpt-fix-hint__source rpt-fix-hint__source--ai">${t('reportDetail.fixSourceAi')}</span>`
              + copyBtn(result.fixedHtml)
              + `</div>`
              + aiDisclaimer();
            return reply.header('content-type', 'text/html').send(html);
          }
        } catch {
          llmFailed = true;
        }
      }

      // Fallback: hardcoded pattern from fix-suggestions.ts
      const fix = getFixSuggestion(criterion, message);
      if (fix) {
        const unavailableNote = (!llmClient || llmFailed)
          ? `<p class="rpt-fix-hint__desc text-muted" style="font-size:var(--font-size-xs);margin-top:var(--space-xs);">`
            + `${t('reportDetail.fixLlmUnavailable')}</p>`
          : '';
        const html =
          `<pre class="rpt-fix-hint__code"><code>${esc(fix.codeExample)}</code></pre>`
          + `<p class="rpt-fix-hint__desc">${esc(fix.description)}</p>`
          + `<div class="rpt-fix-hint__actions">`
          + `<span class="rpt-fix-hint__source rpt-fix-hint__source--pattern">${t('reportDetail.fixSourcePattern')}</span>`
          + `</div>`
          + unavailableNote;
        return reply.header('content-type', 'text/html').send(html);
      }

      // No match — return empty
      return reply.header('content-type', 'text/html').send('');
    },
  );

  // GET /reports/:id/ai-summary — HTMX partial: AI executive summary
  server.get(
    '/reports/:id/ai-summary',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null) {
        return reply.header('content-type', 'text/html').send(
          `<div class="alert alert--warning">Report not found.</div>`,
        );
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (request.user?.role !== 'admin' && scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.header('content-type', 'text/html').send(
          `<div class="alert alert--warning">Access denied.</div>`,
        );
      }

      // Load current report data
      let reportData: ReturnType<typeof normalizeReportData> | null = null;
      try {
        const dbReport = await storage.scans.getReport(id);
        if (dbReport !== null) {
          reportData = normalizeReportData(dbReport as JsonReportFile, scan);
        } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
          const raw = JSON.parse(
            await readFile(scan.jsonReportPath, 'utf-8'),
          ) as JsonReportFile;
          reportData = normalizeReportData(raw, scan);
        }
      } catch {
        // Fall through — reportData stays null
      }

      if (reportData === null || llmClient === null) {
        return reply.header('content-type', 'text/html').send(
          `<div class="alert alert--info">AI summary is not available for this report.</div>`,
        );
      }

      // Build issuesList from issueGroups — flatten to unique criterion + message pairs with counts
      const issueMap = new Map<string, { criterion: string; message: string; count: number; level: string }>();
      for (const group of (reportData as any).issueGroups ?? []) {
        for (const issue of group.issues ?? []) {
          const key = `${group.criterion as string}::${(issue.message ?? issue.title ?? '') as string}`;
          const existing = issueMap.get(key);
          if (existing !== undefined) {
            issueMap.set(key, { ...existing, count: existing.count + (issue.count ?? 1) });
          } else {
            issueMap.set(key, {
              criterion: (group.criterion ?? '') as string,
              message: ((issue.message ?? issue.title ?? '') as string),
              count: (issue.count ?? 1) as number,
              level: (issue.level ?? 'error') as string,
            });
          }
        }
      }
      const issuesList = Array.from(issueMap.values());

      // Build complianceSummary string
      const complianceMatrix = (reportData as any).complianceMatrix ?? [];
      const complianceSummary = (complianceMatrix as any[]).length > 0
        ? (complianceMatrix as any[])
            .map((j: any) => `${(j.jurisdiction ?? j.name ?? 'Unknown') as string}: ${(j.reviewStatus ?? 'unknown') as string}`)
            .join(', ')
        : 'No compliance data available.';

      // RPT-06: Pattern detection — find prior completed scans for same site
      const recurringPatterns: string[] = [];
      try {
        const priorScans = await storage.scans.listScans({
          siteUrl: scan.siteUrl,
          orgId: scan.orgId,
          status: 'completed',
          limit: 5,
        });
        // Exclude the current scan
        const otherScans = priorScans.filter((s) => s.id !== id);

        if (otherScans.length > 0) {
          // Collect all criterion keys from prior scans
          const criteriaFrequency = new Map<string, number>();
          for (const priorScan of otherScans) {
            try {
              const priorReport = await storage.scans.getReport(priorScan.id);
              if (priorReport !== null) {
                const priorData = normalizeReportData(priorReport as JsonReportFile, priorScan);
                for (const group of (priorData as any).issueGroups ?? []) {
                  const c = group.criterion as string;
                  if (c) criteriaFrequency.set(c, (criteriaFrequency.get(c) ?? 0) + 1);
                }
              }
            } catch {
              // Skip unreadable prior scans
            }
          }
          // Criteria that appear in current scan AND at least 1 prior scan
          const currentCriteria = new Set(issuesList.map((i) => i.criterion));
          for (const [criterion, freq] of criteriaFrequency.entries()) {
            if (currentCriteria.has(criterion) && freq >= 1) {
              recurringPatterns.push(`${criterion} has appeared in ${freq} previous scan(s) for this site`);
            }
          }
        }
      } catch {
        // Pattern detection is best-effort — continue without it
      }

      // Call LLM
      try {
        const result = await llmClient.analyseReport({
          siteUrl: scan.siteUrl,
          totalIssues: ((reportData as any).summary?.totalIssues ?? issuesList.reduce((s, i) => s + i.count, 0)) as number,
          issuesList,
          complianceSummary,
          recurringPatterns,
          ...(orgId !== 'system' ? { orgId } : {}),
        });

        const esc = (s: string) =>
          s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const renderList = (items: string[]) =>
          items.length > 0
            ? `<ul class="rpt-ai-summary__list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
            : `<p class="text-muted">${t('reportDetail.aiSummaryNone')}</p>`;

        const html =
          `<div class="rpt-ai-summary">`
          + `<section class="rpt-ai-summary__section">`
          + `<h3 class="rpt-ai-summary__heading">${t('reportDetail.aiSummaryHeadingExecutive')}</h3>`
          + `<p class="rpt-ai-summary__body">${esc(result.executiveSummary)}</p>`
          + `</section>`
          + `<section class="rpt-ai-summary__section">`
          + `<h3 class="rpt-ai-summary__heading">${t('reportDetail.aiSummaryHeadingFindings')}</h3>`
          + renderList(result.keyFindings)
          + `</section>`
          + (result.patterns.length > 0
            ? `<section class="rpt-ai-summary__section">`
              + `<h3 class="rpt-ai-summary__heading">${t('reportDetail.aiSummaryHeadingPatterns')}</h3>`
              + renderList(result.patterns)
              + `</section>`
            : '')
          + `<section class="rpt-ai-summary__section">`
          + `<h3 class="rpt-ai-summary__heading">${t('reportDetail.aiSummaryHeadingPriorities')}</h3>`
          + renderList(result.priorities)
          + `</section>`
          + `<p class="rpt-ai-summary__footer text-muted">${t('reportDetail.aiSummaryFooter')} &middot; ${new Date().toLocaleString()}</p>`
          + aiDisclaimer()
          + `</div>`;

        return reply.header('content-type', 'text/html').send(html);
      } catch {
        // LLM unavailable — graceful notice
        return reply.header('content-type', 'text/html').send(
          `<div class="alert alert--info">${t('reportDetail.aiSummaryUnavailable')}</div>`,
        );
      }
    },
  );
}
