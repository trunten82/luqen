import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScanDb } from '../db/scans.js';
import { extractCriterion, getWcagDescription } from './wcag-enrichment.js';
import { MANUAL_CRITERIA } from '../manual-criteria.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function inferComponent(selector: string, context: string): string {
  const s = (selector + ' ' + context).toLowerCase();

  // Cookie/consent banners
  if (s.includes('cookie') || s.includes('consent') || s.includes('iubenda') || s.includes('gdpr') || s.includes('onetrust')) return 'Cookie Banner';

  // Navigation
  if (/\bnav(igation|bar)?\b/.test(s) || s.includes('offcanvas') || s.includes('menu') || s.includes('hamburger') || s.includes('sidebar')) return 'Navigation';

  // Header
  if (/\bheader\b/.test(s) || s.includes('site-header') || s.includes('masthead') || s.includes('topbar') || s.includes('top-bar')) return 'Header';

  // Footer
  if (/\bfooter\b/.test(s) || s.includes('site-footer') || s.includes('colophon')) return 'Footer';

  // Document head
  if (s.includes('html > head') || s.includes('<title') || s.includes('<meta') || s.includes('<link')) return 'Document Head';

  // Forms
  if (s.includes('<form') || s.includes('<input') || s.includes('<select') || s.includes('<textarea') || s.includes('search-form') || s.includes('login-form')) return 'Form';

  // Modal/popup
  if (s.includes('modal') || s.includes('popup') || s.includes('dialog') || s.includes('lightbox') || s.includes('overlay')) return 'Modal / Popup';

  // Social/sharing
  if (s.includes('social') || s.includes('share') || s.includes('facebook') || s.includes('twitter') || s.includes('instagram') || s.includes('linkedin') || s.includes('whatsapp')) return 'Social Links';

  // Media
  if (s.includes('<img') || s.includes('<video') || s.includes('<audio') || s.includes('carousel') || s.includes('slider') || s.includes('gallery') || s.includes('swiper')) return 'Media / Carousel';

  // Cards / listings
  if (/\bcard\b/.test(s) || s.includes('listing') || s.includes('grid-item') || s.includes('post-item') || s.includes('product-card')) return 'Card / Listing';

  // Breadcrumb
  if (s.includes('breadcrumb')) return 'Breadcrumb';

  // Widget / sidebar
  if (s.includes('widget') || /\baside\b/.test(s) || s.includes('sidebar')) return 'Widget / Sidebar';

  // CTA / banner
  if (s.includes('cta') || s.includes('call-to-action') || s.includes('banner') || s.includes('hero')) return 'CTA / Banner';

  return 'Shared Layout';
}

interface ReportsQuery {
  q?: string;
  status?: string;
  offset?: string;
  limit?: string;
}

const PAGE_SIZE = 20;

/** Shape of the JSON report file written by core's generateJsonReport or the orchestrator. */
interface JsonReportFile {
  summary?: {
    url?: string;
    pagesScanned?: number;
    pagesFailed?: number;
    totalIssues?: number;
    byLevel?: { error: number; warning: number; notice: number };
  };
  pages?: Array<{
    url: string;
    issueCount: number;
    issues: Array<{
      type: string;
      code: string;
      message: string;
      selector: string;
      context: string;
      wcagCriterion?: string;
      wcagTitle?: string;
      wcagDescription?: string;
      wcagImpact?: string;
      wcagUrl?: string;
      regulations?: Array<{
        shortName: string;
        url?: string;
        obligation?: string;
        enforcementDate?: string;
      }>;
    }>;
  }>;
  errors?: Array<{ url: string; code: string; message: string }>;
  compliance?: {
    summary?: {
      passing?: number;
      failing?: number;
      totalConfirmedViolations?: number;
      totalNeedsReview?: number;
    };
    matrix?: Record<string, {
      jurisdictionId: string;
      jurisdictionName: string;
      status?: string;
      reviewStatus?: string;
      confirmedViolations?: number;
      mandatoryViolations?: number;
      needsReview?: number;
      recommendedViolations?: number;
      optionalViolations?: number;
      regulations?: Array<{
        shortName: string;
        url?: string;
        obligation?: string;
        enforcementDate?: string;
        regulationId?: string;
        regulationName?: string;
        status?: string;
        violations?: Array<{ wcagCriterion: string; obligation: string; issueCount: number }>;
      }>;
    }>;
    issueAnnotations?: Record<string, Array<{
      shortName: string;
      url?: string;
      obligation?: string;
      jurisdictionId?: string;
      regulationName?: string;
    }>>;
    annotatedIssues?: Array<{
      code: string;
      wcagCriterion?: string;
      regulations?: Array<{
        regulationId?: string;
        regulationName?: string;
        shortName: string;
        jurisdictionId?: string;
        obligation?: string;
        enforcementDate?: string;
      }>;
    }>;
  };
  templateIssues?: Array<{
    type: string;
    code: string;
    message: string;
    selector?: string;
    context?: string;
    wcagCriterion?: string;
    wcagTitle?: string;
    wcagUrl?: string;
    regulations?: Array<{
      shortName: string;
      url?: string;
      obligation?: string;
    }>;
    affectedPages: string[];
    affectedCount: number;
  }>;
  // Flat fields written by the dashboard orchestrator
  siteUrl?: string;
  pagesScanned?: number;
  errors_count?: number;
  warnings?: number;
  notices?: number;
  issues?: Array<{ code: string; type: string; message: string; selector: string; context: string; wcagCriterion?: string; wcagTitle?: string; wcagDescription?: string; wcagImpact?: string; wcagUrl?: string; regulations?: Array<{ shortName: string; url?: string; obligation?: string }> }>;
}

function normalizeReportData(raw: JsonReportFile, scan: { siteUrl: string; pagesScanned?: number; errors?: number; warnings?: number; notices?: number }) {
  // Support both the core JSON report format (has summary/pages) and the
  // dashboard orchestrator's simpler format (flat fields + issues array).
  const summary = raw.summary ?? {
    url: raw.siteUrl ?? scan.siteUrl,
    pagesScanned: raw.pagesScanned ?? scan.pagesScanned ?? 0,
    pagesFailed: 0,
    totalIssues: (scan.errors ?? 0) + (scan.warnings ?? 0) + (scan.notices ?? 0),
    byLevel: {
      error: scan.errors ?? 0,
      warning: scan.warnings ?? 0,
      notice: scan.notices ?? 0,
    },
  };

  // If raw.pages exists use it; otherwise build a synthetic single page from flat issues
  const pages = raw.pages ?? (
    raw.issues && raw.issues.length > 0
      ? [{
          url: raw.siteUrl ?? scan.siteUrl,
          issueCount: raw.issues.length,
          issues: raw.issues,
        }]
      : []
  );

  // ── ENRICH ISSUES ──
  // Extract WCAG criterion from pa11y code and add WCAG descriptions + regulation annotations
  // Build issueAnnotations from either the legacy format or the new annotatedIssues array
  let issueAnnotations: Record<string, Array<{ shortName: string; url?: string; obligation?: string; jurisdictionId?: string; regulationName?: string }>> = {};
  if (raw.compliance?.issueAnnotations) {
    issueAnnotations = raw.compliance.issueAnnotations;
  } else if (raw.compliance?.annotatedIssues) {
    // Build a code → regulations lookup from annotatedIssues
    for (const ai of raw.compliance.annotatedIssues) {
      if (ai.regulations && ai.regulations.length > 0) {
        const existing = issueAnnotations[ai.code] ?? [];
        const existingNames = new Set(existing.map((r) => r.shortName));
        const newRegs = ai.regulations
          .filter((r) => !existingNames.has(r.shortName))
          .map((r) => ({
            shortName: r.shortName,
            obligation: r.obligation,
            jurisdictionId: r.jurisdictionId,
            regulationName: r.regulationName,
          }));
        issueAnnotations[ai.code] = [...existing, ...newRegs];
      }
    }
  }

  const enrichedPages = pages.map((page) => {
    const enrichedIssues = (page.issues ?? []).map((issue) => {
      // Already enriched (from core report)?
      if (issue.wcagCriterion) return issue;

      const criterion = extractCriterion(issue.code);
      const wcag = criterion ? getWcagDescription(criterion) : null;
      const regs = issueAnnotations[issue.code] ?? null;

      return {
        ...issue,
        ...(criterion ? { wcagCriterion: criterion } : {}),
        ...(wcag ? { wcagTitle: wcag.title, wcagDescription: wcag.description, wcagImpact: wcag.impact, wcagUrl: wcag.url } : {}),
        ...(regs ? { regulations: regs } : {}),
      };
    });

    return {
      ...page,
      issues: enrichedIssues,
      issueCount: page.issueCount ?? page.issues?.length ?? 0,
    };
  });

  // ── TEMPLATE DEDUP ──
  // Issues appearing on 3+ pages are grouped as templateIssues
  let templateIssues = raw.templateIssues && raw.templateIssues.length > 0
    ? raw.templateIssues
    : null;

  if (!templateIssues && enrichedPages.length >= 3) {
    const fpMap = new Map<string, { pages: string[]; issue: (typeof enrichedPages)[0]['issues'][0] }>();
    for (const page of enrichedPages) {
      for (const issue of page.issues) {
        const fp = `${issue.code}||${issue.selector}||${issue.context}`;
        const existing = fpMap.get(fp);
        if (existing) {
          existing.pages.push(page.url);
        } else {
          fpMap.set(fp, { pages: [page.url], issue });
        }
      }
    }
    const deduped: Array<(typeof enrichedPages)[0]['issues'][0] & { affectedPages: string[]; affectedCount: number }> = [];
    const templateFps = new Set<string>();
    for (const [fp, { pages: affectedPages, issue }] of fpMap) {
      if (affectedPages.length >= 3) {
        templateFps.add(fp);
        deduped.push({ ...issue, affectedPages, affectedCount: affectedPages.length });
      }
    }
    if (deduped.length > 0) {
      templateIssues = deduped;
      // Remove template issues from individual pages
      for (const page of enrichedPages) {
        page.issues = page.issues.filter((i) => !templateFps.has(`${i.code}||${i.selector}||${i.context}`));
      }
    }
  }

  // Enrich template issues with WCAG data if not already present
  const enrichedTemplateIssues = templateIssues?.map((ti) => {
    if (ti.wcagCriterion) return { ...ti, componentName: inferComponent(ti.selector ?? '', ti.context ?? '') };
    const criterion = extractCriterion(ti.code);
    const wcag = criterion ? getWcagDescription(criterion) : null;
    const regs = issueAnnotations[ti.code] ?? null;
    return {
      ...ti,
      componentName: inferComponent(ti.selector ?? '', ti.context ?? ''),
      ...(criterion ? { wcagCriterion: criterion } : {}),
      ...(wcag ? { wcagTitle: wcag.title, wcagUrl: wcag.url } : {}),
      ...(regs && !ti.regulations ? { regulations: regs } : {}),
    };
  }) ?? null;

  const templateIssueCount = enrichedTemplateIssues?.length ?? 0;
  const templateOccurrenceCount = enrichedTemplateIssues
    ? enrichedTemplateIssues.reduce((sum, ti) => sum + (('affectedCount' in ti ? ti.affectedCount : 0) ?? 0), 0)
    : 0;

  // ── GROUP TEMPLATE ISSUES BY COMPONENT (for Templates tab) ──
  type TemplateIssueItem = NonNullable<typeof enrichedTemplateIssues>[number];
  const templateComponents: Array<{
    componentName: string;
    issueCount: number;
    maxAffectedPages: number;
    issues: TemplateIssueItem[];
  }> = [];

  if (enrichedTemplateIssues) {
    const compMap = new Map<string, { issues: TemplateIssueItem[]; allPages: Set<string> }>();
    for (const ti of enrichedTemplateIssues) {
      const name = ('componentName' in ti ? ti.componentName : 'Shared Layout') as string;
      const existing = compMap.get(name);
      const pages = 'affectedPages' in ti && Array.isArray(ti.affectedPages) ? ti.affectedPages as string[] : [];
      if (existing) {
        existing.issues.push(ti);
        for (const p of pages) existing.allPages.add(p);
      } else {
        compMap.set(name, { issues: [ti], allPages: new Set(pages) });
      }
    }
    for (const [name, { issues, allPages }] of compMap) {
      templateComponents.push({
        componentName: name,
        issueCount: issues.length,
        maxAffectedPages: allPages.size,
        issues,
      });
    }
    templateComponents.sort((a, b) => b.maxAffectedPages - a.maxAffectedPages);
  }

  // ── UNIFIED ISSUE GROUPING BY WCAG CRITERION ──
  // Merge ALL issues (page-specific + template) into one list grouped by criterion.
  // Each group carries regulation tags + component tags for filtering.

  type IssueShape = {
    type: string; code: string; message: string; selector: string; context: string;
    wcagCriterion?: string; wcagTitle?: string; wcagDescription?: string; wcagUrl?: string;
    regulations?: Array<{ shortName: string; url?: string; obligation?: string }>;
  };
  type TemplateShape = IssueShape & { componentName: string; affectedPages: string[]; affectedCount: number };

  // Collect page-specific issues (template issues already removed from pages)
  const pageIssues: IssueShape[] = [];
  const pageUrlsByCode = new Map<string, Set<string>>();
  for (const page of enrichedPages) {
    for (const issue of page.issues) {
      pageIssues.push(issue);
      const crit = issue.wcagCriterion ?? issue.code;
      if (!pageUrlsByCode.has(crit)) pageUrlsByCode.set(crit, new Set());
      pageUrlsByCode.get(crit)!.add(page.url);
    }
  }

  // Build unified groups by WCAG criterion
  const typeSortOrder: Record<string, number> = { error: 0, warning: 1, notice: 2 };
  const groupMap = new Map<string, {
    criterion: string;
    title: string;
    wcagUrl?: string;
    regulations: Map<string, { shortName: string; url?: string; obligation?: string }>;
    components: Set<string>;
    issues: IssueShape[];
    templateItems: TemplateShape[];
    pages: Set<string>;
  }>();

  function getOrCreateGroup(criterion: string, title: string, wcagUrl?: string) {
    let g = groupMap.get(criterion);
    if (!g) {
      g = { criterion, title, wcagUrl, regulations: new Map(), components: new Set(), issues: [], templateItems: [], pages: new Set() };
      groupMap.set(criterion, g);
    }
    return g;
  }

  // Add page-specific issues
  for (const issue of pageIssues) {
    const criterion = issue.wcagCriterion ?? issue.code;
    const title = issue.wcagTitle ?? issue.code;
    const g = getOrCreateGroup(criterion, title, issue.wcagUrl);
    g.issues.push(issue);
    if (issue.regulations) {
      for (const r of issue.regulations) g.regulations.set(r.shortName, r);
    }
    const urls = pageUrlsByCode.get(criterion);
    if (urls) for (const u of urls) g.pages.add(u);
  }

  // Add template issues into the same criterion groups
  if (enrichedTemplateIssues) {
    for (const ti of enrichedTemplateIssues) {
      const criterion = ('wcagCriterion' in ti && ti.wcagCriterion) ? ti.wcagCriterion : ti.code;
      const title = ('wcagTitle' in ti && ti.wcagTitle) ? ti.wcagTitle : ti.code;
      const wcagUrl = 'wcagUrl' in ti ? ti.wcagUrl as string : undefined;
      const g = getOrCreateGroup(criterion as string, title as string, wcagUrl);
      const compName = ('componentName' in ti ? ti.componentName : 'Shared Layout') as string;
      g.components.add(compName);
      g.templateItems.push({
        ...ti as unknown as IssueShape,
        componentName: compName,
        affectedPages: 'affectedPages' in ti ? ti.affectedPages as string[] : [],
        affectedCount: 'affectedCount' in ti ? ti.affectedCount as number : 0,
      });
      if (ti.regulations) {
        for (const r of ti.regulations) g.regulations.set(r.shortName, r);
      }
      if ('affectedPages' in ti && Array.isArray(ti.affectedPages)) {
        for (const p of ti.affectedPages as string[]) g.pages.add(p);
      }
    }
  }

  // Build sorted output
  const allIssueGroups = [...groupMap.values()].map((g) => {
    // Sort issues within group: errors first
    g.issues.sort((a, b) => (typeSortOrder[a.type] ?? 3) - (typeSortOrder[b.type] ?? 3));
    const isRegulatory = g.regulations.size > 0;
    const hasTemplate = g.templateItems.length > 0;
    // Count by severity across both page issues and template items
    const allItems = [...g.issues, ...g.templateItems];
    const errorCount = allItems.filter((i) => i.type === 'error').length;
    const warningCount = allItems.filter((i) => i.type === 'warning').length;
    const noticeCount = allItems.filter((i) => i.type === 'notice').length;
    const totalCount = g.issues.length + g.templateItems.reduce((s, t) => s + t.affectedCount, 0);
    return {
      criterion: g.criterion,
      title: g.title,
      wcagUrl: g.wcagUrl,
      count: g.issues.length,
      templateCount: g.templateItems.length,
      totalCount,
      errorCount,
      warningCount,
      noticeCount,
      pageCount: g.pages.size,
      isRegulatory,
      hasTemplate,
      regulations: [...g.regulations.values()],
      components: [...g.components].sort(),
      issues: g.issues,
      templateItems: g.templateItems,
    };
  });
  // Sort: regulatory+template first, then regulatory, then template, then other; within by totalCount desc
  allIssueGroups.sort((a, b) => {
    const tierA = a.isRegulatory && a.hasTemplate ? 0 : a.isRegulatory ? 1 : a.hasTemplate ? 2 : 3;
    const tierB = b.isRegulatory && b.hasTemplate ? 0 : b.isRegulatory ? 1 : b.hasTemplate ? 2 : 3;
    if (tierA !== tierB) return tierA - tierB;
    return b.totalCount - a.totalCount;
  });

  const regulatoryIssueCount = allIssueGroups.filter((g) => g.isRegulatory).reduce((s, g) => s + g.totalCount, 0);
  const templateIssueTotal = allIssueGroups.filter((g) => g.hasTemplate).reduce((s, g) => s + g.templateItems.reduce((ss, t) => ss + t.affectedCount, 0), 0);

  // ── COMPLIANCE MATRIX ──
  // Compute reviewStatus if missing from confirmedViolations / needsReview counts
  const complianceMatrix = raw.compliance?.matrix
    ? Object.values(raw.compliance.matrix).map((entry) => {
        // Normalize field names: mandatoryViolations → confirmedViolations
        const confirmed = entry.confirmedViolations ?? entry.mandatoryViolations ?? 0;
        const review = entry.needsReview ?? entry.recommendedViolations ?? 0;

        // Compute reviewStatus from data
        let reviewStatus = entry.reviewStatus;
        if (!reviewStatus) {
          if (entry.status) {
            reviewStatus = entry.status;
          } else if (confirmed > 0) {
            reviewStatus = 'fail';
          } else if (review > 0) {
            reviewStatus = 'review';
          } else {
            reviewStatus = 'pass';
          }
        }

        // Flatten regulation tags: extract shortName/obligation from nested regulation objects
        const flatRegs = (entry.regulations ?? []).map((r) => ({
          shortName: r.shortName,
          url: r.url,
          obligation: r.obligation ?? (r.violations?.some((v) => v.obligation === 'mandatory') ? 'mandatory' : 'optional'),
        }));

        // Count unique WCAG criteria violated (deduped across regulations)
        const violatedCriteria = new Set<string>();
        for (const reg of entry.regulations ?? []) {
          for (const v of reg.violations ?? []) {
            if (v.obligation === 'mandatory') {
              violatedCriteria.add(v.wcagCriterion);
            }
          }
        }
        const criteriaCount = violatedCriteria.size;

        return {
          ...entry,
          confirmedViolations: criteriaCount > 0 ? criteriaCount : confirmed,
          needsReview: review,
          reviewStatus,
          regulations: flatRegs,
          regulationCount: flatRegs.length,
        };
      })
    : null;

  return {
    summary,
    pages: [...enrichedPages].sort((a, b) => (b.issueCount ?? 0) - (a.issueCount ?? 0)),
    errors: raw.errors ?? [],
    compliance: raw.compliance ?? null,
    complianceMatrix,
    templateIssues: enrichedTemplateIssues,
    templateIssueCount,
    templateOccurrenceCount,
    templateComponents,
    allIssueGroups,
    regulatoryIssueCount,
    templateIssueTotal,
  };
}

export async function reportRoutes(
  server: FastifyInstance,
  db: ScanDb,
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

      const scans = db.listScans({
        ...(q !== undefined && q !== '' ? { siteUrl: q } : {}),
        ...(status !== undefined && status !== '' && status !== 'all'
          ? { status: status as 'queued' | 'running' | 'completed' | 'failed' }
          : {}),
        offset,
        limit: limit + 1, // fetch one extra to detect if there's a next page
      });

      const hasNext = scans.length > limit;
      const page = hasNext ? scans.slice(0, limit) : scans;
      const hasPrev = offset > 0;
      const currentPage = Math.floor(offset / limit) + 1;

      // For each completed scan, find the previous completed scan of the same URL
      // to enable "Compare with previous" links
      const formatted = page.map((s) => {
        let previousScanId: string | undefined;
        if (s.status === 'completed') {
          const previousScans = db.listScans({
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
        return {
          ...s,
          jurisdictions: s.jurisdictions.join(', '),
          createdAtDisplay: new Date(s.createdAt).toLocaleString(),
          completedAtDisplay: s.completedAt
            ? new Date(s.completedAt).toLocaleString()
            : '',
          previousScanId,
        };
      });

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
      const scan = db.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
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

      // If scan is not completed or no JSON file, render a status-only view
      if (
        scan.status !== 'completed' ||
        scan.jsonReportPath === undefined ||
        !existsSync(scan.jsonReportPath)
      ) {
        return reply.view('report-detail.hbs', {
          pageTitle: `Report — ${scan.siteUrl}`,
          currentPath: `/reports/${id}`,
          user: request.user,
          scan: scanMeta,
          reportData: null,
        });
      }

      let reportData: ReturnType<typeof normalizeReportData> | null = null;
      try {
        const raw = JSON.parse(
          await readFile(scan.jsonReportPath, 'utf-8'),
        ) as JsonReportFile;
        reportData = normalizeReportData(raw, scan);
      } catch {
        // Render without report data — template handles the missing case
      }

      // Compute manual testing completion stats
      const manualResults = db.getManualTests(id);
      const manualTested = manualResults.filter(
        (r) => r.status === 'pass' || r.status === 'fail' || r.status === 'na',
      ).length;
      const manualTotal = MANUAL_CRITERIA.length;
      const manualPct = manualTotal > 0 ? Math.round((manualTested / manualTotal) * 100) : 0;

      // Compute issue assignment stats
      const assignmentStats = db.getAssignmentStats(id);
      const assignmentActiveCount = assignmentStats.open + assignmentStats.assigned + assignmentStats.inProgress;

      return reply.view('report-detail.hbs', {
        pageTitle: `Report — ${scan.siteUrl}`,
        currentPath: `/reports/${id}`,
        user: request.user,
        scan: scanMeta,
        reportData,
        manualTestStats: {
          tested: manualTested,
          total: manualTotal,
          percentage: manualPct,
        },
        assignmentStats,
        assignmentActiveCount,
      });
    },
  );

  // GET /reports/:id/print — standalone print-friendly HTML for browser print-to-PDF
  server.get(
    '/reports/:id/print',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = db.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      if (
        scan.status !== 'completed' ||
        scan.jsonReportPath === undefined ||
        !existsSync(scan.jsonReportPath)
      ) {
        return reply.code(404).send({ error: 'Report data not available' });
      }

      let reportData: ReturnType<typeof normalizeReportData> | null = null;
      try {
        const raw = JSON.parse(
          await readFile(scan.jsonReportPath, 'utf-8'),
        ) as JsonReportFile;
        reportData = normalizeReportData(raw, scan);
      } catch {
        return reply.code(500).send({ error: 'Failed to read report data' });
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
      const html = template({
        scan: scanMeta,
        reportData,
        userRole,
        isExecutive: userRole === 'executive',
      });

      return reply.type('text/html').send(html);
    },
  );

  // DELETE /reports/:id — delete scan record and files
  server.delete(
    '/reports/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const scan = db.getScan(id);

      if (scan === null) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Only the creator or admin can delete
      const user = request.user;
      if (
        user?.role !== 'admin' &&
        scan.createdBy !== user?.username
      ) {
        return reply.code(403).send({ error: 'You can only delete your own reports' });
      }

      // Delete report files
      if (scan.jsonReportPath !== undefined && existsSync(scan.jsonReportPath)) {
        await unlink(scan.jsonReportPath).catch(() => undefined);
      }

      db.deleteScan(id);

      // HTMX request — return empty fragment for swap
      if (request.headers['hx-request'] === 'true') {
        return reply.code(200).send('');
      }

      await reply.redirect('/reports');
    },
  );
}
