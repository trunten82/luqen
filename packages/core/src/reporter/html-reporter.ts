import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import type { PageResult, ScanError, ScanSummary, ComplianceEnrichment, RegulationAnnotation } from '../types.js';
import { extractCriterion, getWcagDescription } from '../wcag-descriptions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface HtmlReportInput {
  readonly siteUrl: string;
  readonly pages: readonly PageResult[];
  readonly errors: readonly ScanError[];
  readonly outputDir: string;
  readonly compliance?: ComplianceEnrichment | null;
}

type AnnotatedIssue = PageResult['issues'][number] & {
  wcagTitle?: string;
  wcagDescription?: string;
  wcagImpact?: string;
  wcagCriterion?: string;
  wcagUrl?: string;
  regulations?: readonly RegulationAnnotation[];
};

export interface TemplateIssue extends AnnotatedIssue {
  readonly affectedPages: string[];
  readonly affectedCount: number;
}

function generateTimestamp(): string {
  return new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
}

function slugifyHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  } catch {
    return 'unknown';
  }
}

function buildUniqueFilename(outputDir: string, siteUrl: string, timestamp: string, ext: string): string {
  const host = slugifyHost(siteUrl);
  let filename = `pally-report-${host}-${timestamp}.${ext}`;
  let fullPath = join(outputDir, filename);
  let counter = 1;
  while (existsSync(fullPath)) {
    filename = `pally-report-${host}-${timestamp}-${counter}.${ext}`;
    fullPath = join(outputDir, filename);
    counter++;
  }
  return fullPath;
}

/**
 * Annotate each issue with WCAG description, URL, and regulation tags for the
 * template. Returns a new array — original issues are not mutated.
 * Also extracts template issues (same code+selector+context on 3+ pages).
 */
export function buildAnnotatedPages(
  pages: readonly PageResult[],
  compliance: ComplianceEnrichment | null | undefined,
): {
  annotatedPages: Array<PageResult & { issues: AnnotatedIssue[] }>;
  templateIssues: TemplateIssue[];
} {
  // First pass: annotate all issues
  const annotated = pages.map((page) => ({
    ...page,
    issues: page.issues.map((issue): AnnotatedIssue => {
      const criterion = extractCriterion(issue.code);
      const wcag = criterion ? getWcagDescription(criterion) : undefined;
      const regulations = compliance?.issueAnnotations.get(issue.code) ?? undefined;

      return {
        ...issue,
        ...(criterion ? { wcagCriterion: criterion } : {}),
        ...(wcag
          ? {
              wcagTitle: wcag.title,
              wcagDescription: wcag.description,
              wcagImpact: wcag.impact,
              wcagUrl: wcag.url,
            }
          : {}),
        ...(regulations ? { regulations } : {}),
      };
    }),
  }));

  // Second pass: find template issues (fingerprint appears on 3+ pages)
  const fingerprintPageMap = new Map<string, { pages: string[]; issue: AnnotatedIssue }>();
  for (const page of annotated) {
    for (const issue of page.issues) {
      const fp = `${issue.code}||${issue.selector}||${issue.context}`;
      const existing = fingerprintPageMap.get(fp);
      if (existing) {
        existing.pages.push(page.url);
      } else {
        fingerprintPageMap.set(fp, { pages: [page.url], issue });
      }
    }
  }

  const templateFingerprints = new Set<string>();
  const templateIssues: TemplateIssue[] = [];
  for (const [fp, { pages: affectedPages, issue }] of fingerprintPageMap) {
    if (affectedPages.length >= 3) {
      templateFingerprints.add(fp);
      templateIssues.push({
        ...issue,
        affectedPages,
        affectedCount: affectedPages.length,
      });
    }
  }

  // Third pass: remove template issues from individual page results
  const annotatedPages = annotated.map((page) => ({
    ...page,
    issues: page.issues.filter((issue) => {
      const fp = `${issue.code}||${issue.selector}||${issue.context}`;
      return !templateFingerprints.has(fp);
    }),
  }));

  return { annotatedPages, templateIssues };
}

export async function generateHtmlReport(input: HtmlReportInput): Promise<string> {
  const { siteUrl, pages, errors, outputDir, compliance } = input;
  const byLevel = { error: 0, warning: 0, notice: 0 };
  for (const page of pages) {
    for (const issue of page.issues) {
      if (issue.type in byLevel) byLevel[issue.type as keyof typeof byLevel]++;
    }
  }
  const summary: ScanSummary = {
    url: siteUrl,
    pagesScanned: pages.length,
    pagesFailed: errors.length,
    totalIssues: pages.reduce((sum, p) => sum + p.issueCount, 0),
    byLevel,
  };

  // Register helpers
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('issuesByType', (issues: readonly { type: string }[], type: string) =>
    issues.some((i) => i.type === type),
  );
  Handlebars.registerHelper('countByType', (issues: readonly { type: string }[], type: string) =>
    issues.filter((i) => i.type === type).length,
  );
  Handlebars.registerHelper('obligationClass', (obligation: string) => {
    if (obligation === 'mandatory') return 'obligation-mandatory';
    if (obligation === 'recommended') return 'obligation-recommended';
    return 'obligation-optional';
  });
  Handlebars.registerHelper('complianceStatusClass', (status: string) =>
    status === 'pass' ? 'compliance-pass' : 'compliance-fail',
  );
  Handlebars.registerHelper('hasCompliance', (c: unknown) => c != null);

  const { annotatedPages, templateIssues } = buildAnnotatedPages(pages, compliance);

  // Build compliance matrix array for template (Handlebars cannot iterate Records)
  const complianceMatrix = compliance
    ? Object.values(compliance.matrix).map((j) => ({
        ...j,
        regulations: j.regulations.map((r) => ({ ...r })),
      }))
    : null;

  const templateSource = await readFile(join(__dirname, 'report.hbs'), 'utf-8');
  const template = Handlebars.compile(templateSource);
  const html = template({
    summary,
    pages: annotatedPages,
    errors,
    compliance,
    complianceMatrix,
    templateIssues: templateIssues.length > 0 ? templateIssues : null,
    templateIssueCount: templateIssues.length,
    templateOccurrenceCount: templateIssues.reduce((sum, ti) => sum + ti.affectedCount, 0),
  });

  await mkdir(outputDir, { recursive: true });
  const timestamp = generateTimestamp();
  const reportPath = buildUniqueFilename(outputDir, siteUrl, timestamp, 'html');
  await writeFile(reportPath, html, 'utf-8');
  return reportPath;
}
