import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../auth/middleware.js';
import { Type } from '@sinclair/typebox';
import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorageAdapter } from '../db/index.js';
import { extractCriterion, getWcagDescription } from './wcag-enrichment.js';
import { MANUAL_CRITERIA } from '../manual-criteria.js';
import { normalizeReportData, inferComponent } from '../services/report-service.js';
import { isScanPublicShareable } from './badge.js';
import type { JsonReportFile } from '../services/report-service.js';
import { getFixSuggestion } from '../fix-suggestions.js';
import type { LLMClient } from '../llm-client.js';
import { resolveOrgLLMClient } from '../llm-client.js';
import { t } from '../i18n/index.js';
import { filterDrilldownIssues, isValidDimension } from '../services/brand-drilldown.js';
import { buildVpat } from '../services/vpat-service.js';
import { buildVpatEvidenceGroups } from '../services/vpat-evidence.js';
import { buildRemediationRecord } from '../services/remediation-service.js';
import { HtmlPageSchema } from '../api/schemas/envelope.js';

const ReportIdParams = Type.Object({ id: Type.String() }, { additionalProperties: true });
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
  /**
   * Getter for the current LLM client. Called at the top of each handler so
   * a runtime reload via the admin UI is picked up on the next request.
   * Returns null when LLM is not configured.
   */
  getLLMClient: () => LLMClient | null = () => null,
  /**
   * Dashboard config (currently only selfScanId is read here, to back-compat
   * the dogfood login badge through the public-share gate).
   */
  config: { selfScanId?: string } = {},
): Promise<void> {
  // GET /reports — list with pagination and search
  server.get(
    '/reports',
    {
      preHandler: requirePermission('reports.view'), schema: { ...HtmlPageSchema, tags: ['reports'] } },
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
    {
      preHandler: requirePermission('reports.view'), schema: { ...HtmlPageSchema, tags: ['reports'], params: ReportIdParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
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

      // Phase 64: live-badge id surfaced so the share panel can render the
      // right toggle state + embed snippet without a client round-trip.
      const liveBadge = await storage.siteBadges.getForSite(scan.orgId, scan.siteUrl);
      const liveBadgeId =
        liveBadge !== null && liveBadge.enabled ? liveBadge.id : '';

      // If scan is not completed, render a status-only view
      if (scan.status !== 'completed') {
        return reply.view('report-detail.hbs', {
          pageTitle: `Report — ${scan.siteUrl}`,
          currentPath: `/reports/${id}`,
          user: request.user,
          scan: scanMeta,
          liveBadgeId,
          reportData: null,
          pdfAvailable: true,
          llmEnabled: llmClient !== null,
          brandScore: null,
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
          liveBadgeId,
          reportData: null,
          pdfAvailable: true,
          llmEnabled: llmClient !== null,
          brandScore: null,
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

      // ── Brand score data (Phase 20) ─────────────────────────────────
      const brandScore = await storage.brandScores.getLatestForScan(id);

      let previousScore: import('../services/scoring/types.js').ScoreResult | null = null;
      if (brandScore !== null) {
        const history = await storage.brandScores.getHistoryForSite(
          scan.orgId,
          scan.siteUrl,
          2,
        );
        if (history.length >= 2) {
          previousScore = history[1].result;
        }
      }

      // brandRelatedCount + totalIssues from existing reportData.branding
      const brandRelatedCount = (reportData as any)?.branding?.brandRelatedCount ?? 0;
      const totalIssues = (reportData as any)?.summary?.totalIssues ?? 0;

      // Compute delta for the template
      let brandDelta: number | null = null;
      if (
        brandScore !== null && brandScore.kind === 'scored' &&
        previousScore !== null && previousScore.kind === 'scored'
      ) {
        brandDelta = brandScore.overall - previousScore.overall;
      }
      const brandIsFirstScore = brandScore !== null && brandScore.kind === 'scored' && previousScore === null;

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

      // Verdict line (Phase 57 R2) — one sentence + provenance meta.
      // The sentence MUST acknowledge raw WCAG errors even when the
      // jurisdictional matrix says "pass", because jurisdictional pass
      // ≠ accessibility pass: a site can satisfy every regulation it was
      // checked against and still ship hundreds of WCAG issues that simply
      // aren't tied to a named regulatory rule. Saying "compliant" alone
      // in that case is misleading.
      const errorsCount = reportData?.summary?.byLevel?.error ?? 0;
      const warningsCount = reportData?.summary?.byLevel?.warning ?? 0;
      const pagesCount = reportData?.summary?.pagesScanned ?? 0;
      const issuesCount = reportData?.summary?.totalIssues ?? 0;
      const pagesPhrase = `${pagesCount} page${pagesCount === 1 ? '' : 's'}`;
      const errorsPhrase = `${errorsCount} WCAG error${errorsCount === 1 ? '' : 's'}`;
      const issuesPhrase = `${issuesCount} WCAG issue${issuesCount === 1 ? '' : 's'}`;

      let verdictSentence: string;
      let verdictColourClass: 'fail' | 'warn' | 'pass' | 'info';

      if (complianceStatus === 'fail') {
        // Mandatory regulatory failures present. This is the worst case;
        // raw errors are implied to be at least as bad.
        verdictSentence = `${scan.siteUrl} is non-compliant. ${enrichedFailing} mandatory failure${enrichedFailing === 1 ? '' : 's'}, ${errorsPhrase} across ${pagesPhrase}.`;
        verdictColourClass = 'fail';
      } else if (complianceStatus === 'review') {
        verdictSentence = `${scan.siteUrl} needs review. ${enrichedReview} item${enrichedReview === 1 ? '' : 's'} require manual review, ${errorsPhrase} across ${pagesPhrase}.`;
        verdictColourClass = 'warn';
      } else if (complianceStatus === 'pass' && errorsCount > 0) {
        // Jurisdictionally compliant but still has raw WCAG errors.
        // Honest framing: the regulations were satisfied, but the site
        // is not yet accessible. Down-grade colour to warn.
        verdictSentence = `${scan.siteUrl} satisfies the regulations it was checked against, but has ${errorsPhrase} across ${pagesPhrase} that fall outside the mandatory ruleset.`;
        verdictColourClass = 'warn';
      } else if (complianceStatus === 'pass') {
        verdictSentence = `${scan.siteUrl} is compliant. No mandatory failures and no WCAG errors across ${pagesPhrase}.`;
        verdictColourClass = 'pass';
      } else if (errorsCount > 0) {
        // No compliance matrix configured. Lead with the raw count.
        verdictSentence = `${scan.siteUrl} has ${errorsPhrase} across ${pagesPhrase}. No jurisdictional check was applied.`;
        verdictColourClass = errorsCount > 0 ? 'fail' : 'info';
      } else if (warningsCount > 0 || issuesCount > 0) {
        verdictSentence = `${scan.siteUrl} has ${issuesPhrase} across ${pagesPhrase}, no blocking errors. No jurisdictional check was applied.`;
        verdictColourClass = 'warn';
      } else {
        verdictSentence = `${scan.siteUrl} has no WCAG issues across ${pagesPhrase}.`;
        verdictColourClass = 'pass';
      }
      const standardLabel = (scan.standard ?? '').replace(/^WCAG/i, 'WCAG ').replace(/A{1,3}$/, (m) => ` Level ${m}`).trim();
      const verdictMeta = [
        `Scanned ${scan.completedAt ? new Date(scan.completedAt).toISOString().slice(0, 10) : '—'}`,
        standardLabel || scan.standard,
        scan.jurisdictions && scan.jurisdictions.length > 0 ? scan.jurisdictions.join(' · ') : null,
      ].filter(Boolean).join(' · ');

      return reply.view('report-detail.hbs', {
        pageTitle: `Report — ${scan.siteUrl}`,
        currentPath: `/reports/${id}`,
        user: request.user,
        scan: scanMeta,
        liveBadgeId,
        reportData,
        complianceStatus: verdictColourClass,
        verdictSentence,
        verdictMeta,
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
        brandScore,
        previousScore,
        brandDelta,
        brandIsFirstScore,
        brandRelatedCount,
        totalIssues,
      });
    },
  );

  // GET /reports/:id/print — standalone print-friendly HTML for browser print-to-PDF
  server.get(
    '/reports/:id/print',
    {
      preHandler: requirePermission('reports.view'), schema: { ...HtmlPageSchema, tags: ['reports'], params: ReportIdParams } },
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

  // GET /reports/:id/vpat — standalone, printable VPAT / ACR document.
  // Open + ungated: available for any completed scan the caller can view.
  server.get(
    '/reports/:id/vpat',
    {
      preHandler: requirePermission('reports.vpat'), schema: { ...HtmlPageSchema, tags: ['reports'], params: ReportIdParams } },
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

      const manualResults = await storage.manualTests.getManualTests(id);
      const evidenceCounts = new Map(
        (await storage.manualTestEvidence.countByCriterion(id)).map((c) => [c.criterionId, c.count]),
      );
      const reasonedChangeCount = await storage.manualTestAudit.countReasonedChanges(id);
      // Assemble the dated good-faith remediation record (events + completed-scan
      // trend). Keyed by scan.orgId to match how events are recorded. Empty
      // input → empty record, so the section stays hidden.
      const remOrgId = scan.orgId ?? 'system';
      const [remediationEvents, siteScans] = await Promise.all([
        storage.remediationEvents.listForSite(remOrgId, scan.siteUrl),
        storage.scans.getScansForSite(remOrgId, scan.siteUrl),
      ]);
      const remediation = buildRemediationRecord(remediationEvents, siteScans);
      const vpat = buildVpat(reportData, scan, manualResults, { evidenceCounts, reasonedChangeCount }, remediation);
      // Manual-test evidence ARTIFACTS (screenshots / documents) per criterion —
      // surfaced as an appendix in the report (the COUNT already lands in the
      // remarks via evidenceCounts). The browser fetches files via filePath
      // (/uploads/...); no on-disk resolution needed here.
      const evidenceGroups = buildVpatEvidenceGroups(
        await storage.manualTestEvidence.listEvidence(id),
        vpat,
      );

      // Compile the VPAT template directly with the shared Handlebars singleton
      // (same approach as /reports/:id/print). The global `t` and `formatStandard`
      // helpers are registered in server.ts; we only add the VPAT-specific
      // `conformanceBadge` helper (idempotent — safe to re-register per request).
      const handlebars = (await import('handlebars')).default;
      const viewsDir = resolve(join(__dirname, '..', 'views'));

      handlebars.registerHelper('conformanceBadge', (conformance: string) => {
        const cls =
          conformance === 'Supports' ? 'badge--success' :
          conformance === 'Partially Supports' ? 'badge--warning' :
          conformance === 'Does Not Support' ? 'badge--error' : 'badge--neutral';
        const escaped = handlebars.escapeExpression(conformance);
        return new handlebars.SafeString(`<span class="badge ${cls}">${escaped}</span>`);
      });

      const scanMeta = {
        ...scan,
        createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
      };
      // Locale plumbing mirrors the global preHandler in server.ts: the UI
      // language is stored in the secure session and the global `t` helper reads
      // it from the render root, falling back to 'en'.
      const session = request.session as { get?(key: string): unknown } | undefined;
      const locale =
        (typeof session?.get === 'function'
          ? (session.get('locale') as string | undefined)
          : undefined) ?? 'en';
      const template = handlebars.compile(
        await readFile(join(viewsDir, 'vpat.hbs'), 'utf-8'),
      );
      // Secure-share management surface: only users who can export may create
      // share links; expose the existing ACTIVE links for the panel.
      const perms = (request as unknown as { permissions?: Set<string> }).permissions;
      const canShare = perms?.has('reports.export') === true;
      const now = Date.now();
      const shareLinks = canShare
        ? (await storage.reportShares.listForScan(id))
            .filter((s) => s.revokedAt === null && (s.expiresAt === null || Date.parse(s.expiresAt) > now))
            .map((s) => ({ id: s.id, token: s.token, expiresAt: s.expiresAt }))
        : [];
      // generateCsrf is decorated by @fastify/csrf-protection in production;
      // guard so the VPAT route still renders in test servers that omit it.
      const csrfToken = typeof reply.generateCsrf === 'function' ? reply.generateCsrf() : '';
      const html = template(
        {
          scan: scanMeta,
          vpat,
          evidenceGroups,
          user: request.user,
          pdfUrl: `/api/v1/export/scans/${id}/vpat.pdf`,
          packUrl: evidenceGroups.length > 0 ? `/api/v1/export/scans/${id}/vpat-pack.zip` : null,
          isShared: false,
          canShare,
          shareLinks,
          csrfToken,
        },
        { data: { root: { locale } } },
      );
      return reply.type('text/html').send(html);
    },
  );

  // POST /api/v1/reports/:id/shares — create a secure external share link for
  // this scan's VPAT/ACR + evidence pack. Returns the token (the client builds
  // the absolute /share/<token> URL). Gated by reports.export; org-scoped.
  server.post(
    '/api/v1/reports/:id/shares',
    {
      schema: {
        tags: ['reports'],
        params: ReportIdParams,
        body: Type.Object(
          { expiresInDays: Type.Optional(Type.Union([Type.Number(), Type.Null()])) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            shareId: Type.String(),
            token: Type.String(),
            expiresAt: Type.Union([Type.String(), Type.Null()]),
          }, { additionalProperties: true }),
          404: Type.Object({ error: Type.String() }, { additionalProperties: true }),
        },
      },
      preHandler: requirePermission('reports.export'),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);
      if (scan === null) return reply.code(404).send({ error: 'Report not found' });
      const orgId = request.user?.currentOrgId ?? 'system';
      if (request.user?.role !== 'admin' && scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }
      const body = (request.body ?? {}) as { expiresInDays?: number | null };
      const share = await storage.reportShares.createShare({
        scanId: id,
        orgId: scan.orgId ?? 'system',
        createdBy: request.user?.id ?? null,
        expiresInDays: body.expiresInDays,
      });
      return reply.send({ shareId: share.id, token: share.token, expiresAt: share.expiresAt });
    },
  );

  // POST /api/v1/reports/:id/shares/:shareId/revoke — revoke a share link.
  server.post(
    '/api/v1/reports/:id/shares/:shareId/revoke',
    {
      schema: {
        tags: ['reports'],
        params: Type.Object({ id: Type.String(), shareId: Type.String() }, { additionalProperties: true }),
        body: Type.Optional(Type.Object({}, { additionalProperties: true })),
        response: {
          200: Type.Object({ revoked: Type.Boolean() }, { additionalProperties: true }),
          404: Type.Object({ error: Type.String() }, { additionalProperties: true }),
        },
      },
      preHandler: requirePermission('reports.export'),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, shareId } = request.params as { id: string; shareId: string };
      const share = await storage.reportShares.getShare(shareId);
      if (share === null || share.scanId !== id) {
        return reply.code(404).send({ error: 'Share not found' });
      }
      const orgId = request.user?.currentOrgId ?? 'system';
      if (request.user?.role !== 'admin' && share.orgId !== orgId && share.orgId !== 'system') {
        return reply.code(404).send({ error: 'Share not found' });
      }
      const revoked = await storage.reportShares.revoke(shareId);
      return reply.send({ revoked });
    },
  );

  // POST /api/v1/reports/:id/public-share — toggle the public-share opt-in
  // for the given scan. Owner-or-admin scoped via currentOrgId. Idempotent.
  server.post(
    '/api/v1/reports/:id/public-share',
    {
      preHandler: requirePermission('reports.export'),
      schema: {
        tags: ['reports'],
        params: ReportIdParams,
        body: Type.Object({
          enabled: Type.Boolean(),
        }, { additionalProperties: false }),
        response: {
          200: Type.Object({
            scanId:             Type.String(),
            publicShareEnabled: Type.Boolean(),
            badgeUrl:           Type.String(),
            reportUrl:          Type.String(),
          }),
          403: Type.Object({ error: Type.String() }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const enabled = (request.body as { enabled: boolean }).enabled;
      const scan = await storage.scans.getScan(id);
      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }
      const orgId = request.user?.currentOrgId ?? 'system';
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && scan.orgId !== orgId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const ok = await storage.scans.setPublicShare(
        id,
        scan.orgId,
        enabled,
        request.user?.id ?? 'unknown',
      );
      if (!ok) {
        return reply.code(404).send({ error: 'Report not found' });
      }
      const host = request.headers.host ?? '';
      return reply.send({
        scanId: id,
        publicShareEnabled: enabled,
        badgeUrl: `https://${host}/api/v1/badge/${id}.svg`,
        reportUrl: `https://${host}/reports/${id}/public`,
      });
    },
  );

  // POST /api/v1/reports/:id/site-badge — turn the dynamic (live) badge
  // on or off for the scan's siteUrl. The badge URL stays stable even as
  // new scans land — the resolver always returns the latest completed
  // scan for (orgId, siteUrl). Owner-or-admin scoped.
  server.post(
    '/api/v1/reports/:id/site-badge',
    {
      preHandler: requirePermission('reports.export'),
      schema: {
        tags: ['reports'],
        params: ReportIdParams,
        body: Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }),
        response: {
          200: Type.Object({
            badgeId:     Type.String(),
            siteUrl:     Type.String(),
            enabled:     Type.Boolean(),
            badgeUrlSvg: Type.String(),
            badgeUrlJson:Type.String(),
          }),
          403: Type.Object({ error: Type.String() }),
          404: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const enabled = (request.body as { enabled: boolean }).enabled;
      const scan = await storage.scans.getScan(id);
      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }
      const orgId = request.user?.currentOrgId ?? 'system';
      const isAdmin = request.user?.role === 'admin';
      if (!isAdmin && scan.orgId !== orgId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      // Always store under the scan's own org (admins acting on
      // another org's scan still produce an org-scoped badge).
      const badge = enabled
        ? await storage.siteBadges.enable(scan.orgId, scan.siteUrl, request.user?.id ?? 'unknown')
        : (await storage.siteBadges.getForSite(scan.orgId, scan.siteUrl));
      if (badge === null) {
        // disable requested on a site that never had a badge — return a
        // synthetic disabled response so the client's UI state matches.
        return reply.send({
          badgeId: '',
          siteUrl: scan.siteUrl,
          enabled: false,
          badgeUrlSvg: '',
          badgeUrlJson: '',
        });
      }
      if (!enabled) {
        await storage.siteBadges.setEnabled(badge.id, scan.orgId, false);
      }
      const host = request.headers.host ?? '';
      return reply.send({
        badgeId: badge.id,
        siteUrl: badge.siteUrl,
        enabled,
        badgeUrlSvg:  `https://${host}/api/v1/badge/live/${badge.id}.svg`,
        badgeUrlJson: `https://${host}/api/v1/badge/live/${badge.id}.json`,
      });
    },
  );

  // GET /reports/:id/public — anonymous public view (Phase 58 R5).
  // Strips admin chrome, shows the verdict line + summary + per-page issues.
  // Public iff:
  //   - scan exists and is completed, AND
  //   - the org owning the scan has opted in via scan.publicShareEnabled
  //     OR the scan is marked publicly shareable for this dashboard
  //     (initial cut: any scan of the dashboard's own host is public).
  server.get(
    '/reports/:id/public',
    { schema: { ...HtmlPageSchema, tags: ['reports'], params: ReportIdParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);
      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }
      if (scan.status !== 'completed') {
        return reply.code(404).send({ error: 'Report not available' });
      }

      const reqHost = request.headers.host ?? '';
      const allow = isScanPublicShareable(scan, config.selfScanId, reqHost);
      if (!allow) {
        return reply.code(404).send({ error: 'Report not public' });
      }

      let reportData: ReturnType<typeof normalizeReportData> | null = null;
      try {
        const dbReport = await storage.scans.getReport(id);
        if (dbReport !== null) {
          reportData = normalizeReportData(dbReport as JsonReportFile, scan);
        } else if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
          const raw = JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as JsonReportFile;
          reportData = normalizeReportData(raw, scan);
        }
      } catch {
        return reply.code(500).send({ error: 'Failed to read report data' });
      }
      if (reportData === null) {
        return reply.code(404).send({ error: 'Report data not available' });
      }

      // Verdict (same logic as the authenticated view).
      const enrichedFailing = (reportData as { compliance?: { summary?: { failing?: number } } }).compliance?.summary?.failing ?? 0;
      const enrichedReview = (reportData as { compliance?: { summary?: { needsReview?: number } } }).compliance?.summary?.needsReview ?? 0;
      const hasCompliance = reportData?.complianceMatrix != null;
      const errorsCount = reportData?.summary?.byLevel?.error ?? 0;
      const warningsCount = reportData?.summary?.byLevel?.warning ?? 0;
      const noticesCount = reportData?.summary?.byLevel?.notice ?? 0;
      const issuesCount = reportData?.summary?.totalIssues ?? 0;
      const pagesCount = reportData?.summary?.pagesScanned ?? 0;
      const pagesPhrase = `${pagesCount} page${pagesCount === 1 ? '' : 's'}`;
      const errorsPhrase = `${errorsCount} WCAG error${errorsCount === 1 ? '' : 's'}`;
      const noticesPhrase = `${warningsCount + noticesCount} non-blocking issue${(warningsCount + noticesCount) === 1 ? '' : 's'}`;
      let verdictSentence: string;
      let verdictColourClass: 'fail' | 'warn' | 'pass' | 'info';
      if (hasCompliance && enrichedFailing > 0) {
        verdictSentence = `${scan.siteUrl} is non-compliant. ${enrichedFailing} mandatory failure${enrichedFailing === 1 ? '' : 's'}, ${errorsPhrase} across ${pagesPhrase}.`;
        verdictColourClass = 'fail';
      } else if (hasCompliance && enrichedReview > 0) {
        verdictSentence = `${scan.siteUrl} needs review. ${enrichedReview} item${enrichedReview === 1 ? '' : 's'} require manual review, ${errorsPhrase} across ${pagesPhrase}.`;
        verdictColourClass = 'warn';
      } else if (hasCompliance && errorsCount > 0) {
        verdictSentence = `${scan.siteUrl} satisfies the regulations it was checked against, but has ${errorsPhrase} across ${pagesPhrase} that fall outside the mandatory ruleset.`;
        verdictColourClass = 'warn';
      } else if (hasCompliance) {
        verdictSentence = `${scan.siteUrl} is compliant. No mandatory failures and no WCAG errors across ${pagesPhrase}.`;
        verdictColourClass = 'pass';
      } else if (errorsCount > 0) {
        verdictSentence = `${scan.siteUrl} has ${errorsPhrase} across ${pagesPhrase}. No jurisdictional check was applied.`;
        verdictColourClass = 'fail';
      } else if (warningsCount + noticesCount > 0) {
        verdictSentence = `${scan.siteUrl} has no blocking errors across ${pagesPhrase}, but ${noticesPhrase} for manual review.`;
        verdictColourClass = 'pass';
      } else if (issuesCount > 0) {
        verdictSentence = `${scan.siteUrl} has ${issuesCount} WCAG issue${issuesCount === 1 ? '' : 's'} across ${pagesPhrase}, no blocking errors.`;
        verdictColourClass = 'warn';
      } else {
        verdictSentence = `${scan.siteUrl} has no WCAG issues across ${pagesPhrase}.`;
        verdictColourClass = 'pass';
      }
      const standardLabel = (scan.standard ?? '').replace(/^WCAG/i, 'WCAG ').replace(/A{1,3}$/, (m) => ` Level ${m}`).trim();
      const verdictMeta = [
        `Scanned ${scan.completedAt ? new Date(scan.completedAt).toISOString().slice(0, 10) : '—'}`,
        standardLabel || scan.standard,
      ].filter(Boolean).join(' · ');

      const handlebars = (await import('handlebars')).default;
      const viewsDir = resolve(join(__dirname, '..', 'views'));
      const tmpl = handlebars.compile(await readFile(join(viewsDir, 'report-public.hbs'), 'utf-8'));
      const html = tmpl({
        scan: { ...scan, jurisdictions: scan.jurisdictions.join(', ') },
        reportData,
        verdictSentence,
        verdictColourClass,
        verdictMeta,
        badgeSrc: `/api/v1/badge/${id}.svg`,
      });
      return reply.type('text/html').send(html);
    },
  );

  // DELETE /reports/:id — delete scan record and files
  server.delete(
    '/reports/:id',
    {
      schema: { ...HtmlPageSchema, tags: ['reports'], params: ReportIdParams } },
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
    {
      preHandler: requirePermission('llm.view'), schema: { ...HtmlPageSchema, tags: ['reports'], params: ReportIdParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
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
        `<button type="button" class="btn btn--sm btn--ghost rpt-fix-hint__copy-btn" aria-label="Copy fix suggestion to clipboard" `
        + `data-copy-text="${esc(html)}">Copy</button>`;

      // Try LLM first
      let llmFailed = false;
      if (llmClient) {
        const orgId = request.user?.currentOrgId ?? undefined;
        const { client: effectiveLlm, isPerOrg } = await resolveOrgLLMClient(
          llmClient, storage.organizations, orgId,
        );
        try {
          const result = await effectiveLlm!.generateFix({
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
        } finally {
          if (isPerOrg && effectiveLlm) effectiveLlm.destroy();
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
    {
      preHandler: requirePermission('llm.view'), schema: { ...HtmlPageSchema, tags: ['reports'], params: ReportIdParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const llmClient = getLLMClient();
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

      // Call LLM — use per-org credentials when available, system client as fallback
      const effectiveOrgId = orgId !== 'system' ? orgId : undefined;
      const { client: effectiveLlm, isPerOrg } = await resolveOrgLLMClient(
        llmClient, storage.organizations, effectiveOrgId,
      );
      try {
        const result = await effectiveLlm!.analyseReport({
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
      } finally {
        if (isPerOrg && effectiveLlm) effectiveLlm.destroy();
      }
    },
  );

  // GET /reports/:id/brand-drilldown — HTMX partial: dimension drilldown modal
  server.get(
    '/reports/:id/brand-drilldown',
    {
      preHandler: requirePermission('reports.view'), schema: { ...HtmlPageSchema, tags: ['reports'], params: ReportIdParams } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { dimension?: string };
      const dimensionRaw = query.dimension ?? '';

      if (!isValidDimension(dimensionRaw)) {
        return reply.code(400).header('content-type', 'text/html').send(
          `<div class="alert alert--warning">Invalid dimension parameter.</div>`,
        );
      }
      const dimension = dimensionRaw;

      const { id } = request.params as { id: string };
      const scan = await storage.scans.getScan(id);

      if (scan === null || scan.status !== 'completed') {
        return reply.code(404).header('content-type', 'text/html').send(
          `<div class="alert alert--warning">Report not found.</div>`,
        );
      }

      // Org-scoping: admin sees all, others check orgId match
      const orgId = request.user?.currentOrgId ?? 'system';
      if (request.user?.role !== 'admin' && scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).header('content-type', 'text/html').send(
          `<div class="alert alert--warning">Report not found.</div>`,
        );
      }

      // Load report data
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
        // Fall through
      }

      const issues = reportData !== null
        ? filterDrilldownIssues(dimension, reportData)
        : [];

      // Resolve dimension label via i18n
      const dimensionLabelMap: Record<string, string> = {
        color: t('reportDetail.brandScoreColorContrast'),
        typography: t('reportDetail.brandScoreTypography'),
        components: t('reportDetail.brandScoreComponents'),
      };
      const dimensionLabel = dimensionLabelMap[dimension] ?? dimension;

      // Get dimension sub-score value from brand score
      let dimensionScore: number | null = null;
      try {
        const brandScore = await storage.brandScores.getLatestForScan(id);
        if (brandScore !== null && brandScore.kind === 'scored') {
          const sub = brandScore[dimension];
          if (sub.kind === 'scored') {
            dimensionScore = sub.value;
          }
        }
      } catch {
        // Best-effort — score badge is optional
      }

      return reply.view('partials/brand-drilldown-modal.hbs', {
        issues,
        dimension,
        dimensionLabel,
        dimensionScore,
      });
    },
  );
}
