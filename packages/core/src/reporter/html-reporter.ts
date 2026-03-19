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

function generateTimestamp(): string {
  return new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
}

function buildUniqueFilename(outputDir: string, timestamp: string): string {
  let filename = `pally-report-${timestamp}.html`;
  let fullPath = join(outputDir, filename);
  let counter = 1;
  while (existsSync(fullPath)) {
    filename = `pally-report-${timestamp}-${counter}.html`;
    fullPath = join(outputDir, filename);
    counter++;
  }
  return fullPath;
}

/**
 * Annotate each issue with WCAG description and regulation tags for the
 * template. Returns a new array — original issues are not mutated.
 */
function buildAnnotatedPages(
  pages: readonly PageResult[],
  compliance: ComplianceEnrichment | null | undefined,
): Array<PageResult & { issues: Array<PageResult['issues'][number] & {
  wcagTitle?: string;
  wcagDescription?: string;
  wcagImpact?: string;
  wcagCriterion?: string;
  regulations?: readonly RegulationAnnotation[];
}> }> {
  return pages.map((page) => ({
    ...page,
    issues: page.issues.map((issue) => {
      const criterion = extractCriterion(issue.code);
      const wcag = criterion ? getWcagDescription(criterion) : undefined;
      const regulations = compliance?.issueAnnotations.get(issue.code) ?? undefined;

      return {
        ...issue,
        ...(criterion ? { wcagCriterion: criterion } : {}),
        ...(wcag ? { wcagTitle: wcag.title, wcagDescription: wcag.description, wcagImpact: wcag.impact } : {}),
        ...(regulations ? { regulations } : {}),
      };
    }),
  }));
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

  const annotatedPages = buildAnnotatedPages(pages, compliance);

  // Build compliance matrix array for template (Handlebars cannot iterate Records)
  const complianceMatrix = compliance
    ? Object.values(compliance.matrix).map((j) => ({
        ...j,
        regulations: j.regulations.map((r) => ({ ...r })),
      }))
    : null;

  const templateSource = await readFile(join(__dirname, 'report.hbs'), 'utf-8');
  const template = Handlebars.compile(templateSource);
  const html = template({ summary, pages: annotatedPages, errors, compliance, complianceMatrix });

  await mkdir(outputDir, { recursive: true });
  const timestamp = generateTimestamp();
  const reportPath = buildUniqueFilename(outputDir, timestamp);
  await writeFile(reportPath, html, 'utf-8');
  return reportPath;
}
