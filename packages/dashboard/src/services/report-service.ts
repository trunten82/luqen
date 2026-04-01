import { extractCriterion, getWcagDescription } from '../routes/wcag-enrichment.js';

// ---------------------------------------------------------------------------
// JSON report file shape (shared across routes, export, email, PDF)
// ---------------------------------------------------------------------------

export interface JsonReportFile {
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
  issues?: Array<{
    code: string; type: string; message: string; selector: string; context: string;
    wcagCriterion?: string; wcagTitle?: string; wcagDescription?: string;
    wcagImpact?: string; wcagUrl?: string;
    regulations?: Array<{ shortName: string; url?: string; obligation?: string }>;
  }>;
  branding?: {
    guidelineName?: string;
    guidelineVersion?: string;
    complianceExcludingBrand?: number;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Component inference from selector + context
// ---------------------------------------------------------------------------

export function inferComponent(selector: string, context: string): string {
  const s = (selector + ' ' + context).toLowerCase();

  if (s.includes('cookie') || s.includes('consent') || s.includes('iubenda') || s.includes('gdpr') || s.includes('onetrust')) return 'Cookie Banner';
  if (/\bnav(igation|bar)?\b/.test(s) || s.includes('offcanvas') || s.includes('menu') || s.includes('hamburger') || s.includes('sidebar')) return 'Navigation';
  if (/\bheader\b/.test(s) || s.includes('site-header') || s.includes('masthead') || s.includes('topbar') || s.includes('top-bar')) return 'Header';
  if (/\bfooter\b/.test(s) || s.includes('site-footer') || s.includes('colophon')) return 'Footer';
  if (s.includes('html > head') || s.includes('<title') || s.includes('<meta') || s.includes('<link')) return 'Document Head';
  if (s.includes('<form') || s.includes('<input') || s.includes('<select') || s.includes('<textarea') || s.includes('search-form') || s.includes('login-form')) return 'Form';
  if (s.includes('modal') || s.includes('popup') || s.includes('dialog') || s.includes('lightbox') || s.includes('overlay')) return 'Modal / Popup';
  if (s.includes('social') || s.includes('share') || s.includes('facebook') || s.includes('twitter') || s.includes('instagram') || s.includes('linkedin') || s.includes('whatsapp')) return 'Social Links';
  if (s.includes('<img') || s.includes('<video') || s.includes('<audio') || s.includes('carousel') || s.includes('slider') || s.includes('gallery') || s.includes('swiper')) return 'Media / Carousel';
  if (/\bcard\b/.test(s) || s.includes('listing') || s.includes('grid-item') || s.includes('post-item') || s.includes('product-card')) return 'Card / Listing';
  if (s.includes('breadcrumb')) return 'Breadcrumb';
  if (s.includes('widget') || /\baside\b/.test(s) || s.includes('sidebar')) return 'Widget / Sidebar';
  if (s.includes('cta') || s.includes('call-to-action') || s.includes('banner') || s.includes('hero')) return 'CTA / Banner';

  return 'Shared Layout';
}

// ---------------------------------------------------------------------------
// normalizeReportData — single source of truth for report rendering
// ---------------------------------------------------------------------------

export function normalizeReportData(raw: JsonReportFile, scan: { siteUrl: string; pagesScanned?: number; errors?: number; warnings?: number; notices?: number }) {
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
  let issueAnnotations: Record<string, Array<{ shortName: string; url?: string; obligation?: string; jurisdictionId?: string; regulationName?: string }>> = {};
  if (raw.compliance?.issueAnnotations) {
    issueAnnotations = raw.compliance.issueAnnotations;
  } else if (raw.compliance?.annotatedIssues) {
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
      for (const page of enrichedPages) {
        page.issues = page.issues.filter((i) => !templateFps.has(`${i.code}||${i.selector}||${i.context}`));
      }
    }
  }

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

  // ── GROUP TEMPLATE ISSUES BY COMPONENT ──
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
      const tiPages = 'affectedPages' in ti && Array.isArray(ti.affectedPages) ? ti.affectedPages as string[] : [];
      if (existing) {
        existing.issues.push(ti);
        for (const p of tiPages) existing.allPages.add(p);
      } else {
        compMap.set(name, { issues: [ti], allPages: new Set(tiPages) });
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
  type IssueShape = {
    type: string; code: string; message: string; selector: string; context: string;
    wcagCriterion?: string; wcagTitle?: string; wcagDescription?: string; wcagUrl?: string;
    regulations?: Array<{ shortName: string; url?: string; obligation?: string }>;
  };
  type TemplateShape = IssueShape & { componentName: string; affectedPages: string[]; affectedCount: number };

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

  const allIssueGroups = [...groupMap.values()].map((g) => {
    g.issues.sort((a, b) => (typeSortOrder[a.type] ?? 3) - (typeSortOrder[b.type] ?? 3));
    const isRegulatory = g.regulations.size > 0;
    const hasTemplate = g.templateItems.length > 0;
    const allItems = [...g.issues, ...g.templateItems];
    const errorCount = allItems.filter((i) => i.type === 'error').length;
    const warningCount = allItems.filter((i) => i.type === 'warning').length;
    const noticeCount = allItems.filter((i) => i.type === 'notice').length;
    const totalCount = g.issues.length + g.templateItems.reduce((s, t) => s + t.affectedCount, 0);
    const brandCount = g.issues.filter((i) => (i as Record<string, unknown>).brandMatch && ((i as Record<string, unknown>).brandMatch as Record<string, unknown>).matched).length;
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
      hasBrandIssues: brandCount > 0,
      brandCount,
      regulations: [...g.regulations.values()],
      components: [...g.components].sort(),
      issues: g.issues,
      templateItems: g.templateItems,
    };
  });
  allIssueGroups.sort((a, b) => {
    const tierA = a.isRegulatory && a.hasTemplate ? 0 : a.isRegulatory ? 1 : a.hasTemplate ? 2 : 3;
    const tierB = b.isRegulatory && b.hasTemplate ? 0 : b.isRegulatory ? 1 : b.hasTemplate ? 2 : 3;
    if (tierA !== tierB) return tierA - tierB;
    return b.totalCount - a.totalCount;
  });

  const regulatoryIssueCount = allIssueGroups.filter((g) => g.isRegulatory).reduce((s, g) => s + g.totalCount, 0);
  const templateIssueTotal = allIssueGroups.filter((g) => g.hasTemplate).reduce((s, g) => s + g.templateItems.reduce((ss, t) => ss + t.affectedCount, 0), 0);

  // ── COMPLIANCE MATRIX ──
  const complianceMatrix = raw.compliance?.matrix
    ? Object.values(raw.compliance.matrix).map((entry) => {
        // confirmedViolations = actual errors on mandatory criteria (from enrichment)
        // mandatoryViolations = all issues on mandatory criteria regardless of severity (from checker)
        const hasExplicitConfirmed = entry.confirmedViolations != null;
        const confirmed = entry.confirmedViolations ?? 0;
        const mandatoryTotal = entry.mandatoryViolations ?? 0;
        const review = entry.needsReview ?? entry.recommendedViolations ?? 0;

        let reviewStatus = entry.reviewStatus;
        if (!reviewStatus) {
          if (entry.status && entry.status !== 'fail') {
            // Trust non-fail status values (review, pass) from legacy reports
            reviewStatus = entry.status;
          } else if (hasExplicitConfirmed && confirmed > 0) {
            // Report explicitly marked these as confirmed errors
            reviewStatus = 'fail';
          } else if (!hasExplicitConfirmed && mandatoryTotal > 0) {
            // Legacy report: mandatoryViolations includes all severity levels
            // If scan had 0 errors, they're all notices/warnings → review, not fail
            const scanHasErrors = (scan.errors ?? 0) > 0;
            reviewStatus = scanHasErrors ? 'fail' : 'review';
          } else if (review > 0) {
            reviewStatus = 'review';
          } else {
            reviewStatus = 'pass';
          }
        }

        const flatRegs = (entry.regulations ?? []).map((r) => ({
          shortName: r.shortName,
          url: r.url,
          obligation: r.obligation ?? (r.violations?.some((v) => v.obligation === 'mandatory') ? 'mandatory' : 'optional'),
          violations: (r.violations ?? []).map((v) => ({
            wcagCriterion: v.wcagCriterion,
            obligation: v.obligation,
            issueCount: v.issueCount,
          })),
        }));

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
          confirmedViolations: criteriaCount > 0 ? criteriaCount : (hasExplicitConfirmed ? confirmed : mandatoryTotal),
          needsReview: review,
          reviewStatus,
          regulations: flatRegs,
          regulationCount: flatRegs.length,
        };
      })
    : null;

  // Recompute compliance summary counts from enriched matrix (fixes legacy reports)
  const enrichedCompliance = raw.compliance
    ? {
        ...raw.compliance,
        summary: {
          ...raw.compliance.summary,
          ...(complianceMatrix != null
            ? {
                passing: complianceMatrix.filter((e: any) => e.reviewStatus === 'pass').length,
                failing: complianceMatrix.filter((e: any) => e.reviewStatus === 'fail').length,
                needsReview: complianceMatrix.filter((e: any) => e.reviewStatus === 'review').length,
              }
            : {}),
        },
      }
    : null;

  // Branding summary — count brand-related issues if branding data present
  let brandingSummary: {
    guidelineName?: string;
    guidelineVersion?: string;
    complianceExcludingBrand?: number;
    brandRelatedCount: number;
    unexpectedCount: number;
    [key: string]: unknown;
  } | undefined;
  if (raw.branding) {
    let brandRelatedCount = 0;
    for (const page of enrichedPages) {
      for (const issue of (page.issues ?? [])) {
        if ((issue as Record<string, unknown>).brandMatch &&
            ((issue as Record<string, unknown>).brandMatch as Record<string, unknown>).matched) {
          brandRelatedCount++;
        }
      }
    }
    brandingSummary = {
      ...raw.branding,
      brandRelatedCount,
      unexpectedCount: (summary?.totalIssues ?? 0) - brandRelatedCount,
    };
  }

  return {
    summary,
    pages: [...enrichedPages].sort((a, b) => (b.issueCount ?? 0) - (a.issueCount ?? 0)),
    errors: raw.errors ?? [],
    compliance: enrichedCompliance,
    complianceMatrix,
    templateIssues: enrichedTemplateIssues,
    templateIssueCount,
    templateOccurrenceCount,
    templateComponents,
    allIssueGroups,
    regulatoryIssueCount,
    templateIssueTotal,
    topActionItems: allIssueGroups
      .filter((g) => g.errorCount > 0 || (g.warningCount > 0 && g.isRegulatory))
      .slice(0, 15)
      .map((g) => ({
        severity: g.errorCount > 0 ? 'error' : 'warning',
        count: g.errorCount > 0 ? g.errorCount : g.warningCount,
        criterion: g.criterion,
        title: g.title,
        pageCount: g.pageCount,
        regulations: g.regulations,
      })),
    ...(brandingSummary !== undefined ? { branding: brandingSummary } : {}),
  };
}
