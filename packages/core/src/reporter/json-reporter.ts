import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PageResult, ScanError, ScanReport, ComplianceEnrichment } from '../types.js';
import { buildAnnotatedPages } from './html-reporter.js';

interface JsonReportInput {
  readonly siteUrl: string;
  readonly pages: readonly PageResult[];
  readonly errors: readonly ScanError[];
  readonly outputDir: string;
  readonly compliance?: ComplianceEnrichment | null;
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
  let filename = `luqen-report-${host}-${timestamp}.${ext}`;
  let fullPath = join(outputDir, filename);
  let counter = 1;
  while (existsSync(fullPath)) {
    filename = `luqen-report-${host}-${timestamp}-${counter}.${ext}`;
    fullPath = join(outputDir, filename);
    counter++;
  }
  return fullPath;
}

/**
 * Serialize a ComplianceEnrichment for JSON output.
 * The issueAnnotations Map must be converted to a plain object.
 * Also includes confirmedViolations / needsReview in the enriched matrix entries.
 */
function serializeCompliance(
  compliance: ComplianceEnrichment,
  pages: readonly import('../types.js').PageResult[],
): Record<string, unknown> {
  const annotationsObj: Record<string, unknown> = {};
  for (const [key, value] of compliance.issueAnnotations) {
    annotationsObj[key] = value;
  }

  // Compute per-jurisdiction confirmed/needsReview counts
  const enrichedMatrix: Record<string, unknown> = {};
  for (const [jid, j] of Object.entries(compliance.matrix)) {
    let confirmed = 0;
    let needsReviewCount = 0;
    for (const page of pages) {
      for (const issue of page.issues) {
        const annotations = compliance.issueAnnotations.get(issue.code);
        if (!annotations) continue;
        const hasMandatory = annotations.some(
          (a) => a.jurisdictionId === j.jurisdictionId && a.obligation === 'mandatory',
        );
        if (!hasMandatory) continue;
        if (issue.type === 'error') {
          confirmed++;
        } else {
          needsReviewCount++;
        }
      }
    }
    const reviewStatus: 'fail' | 'review' | 'pass' =
      confirmed > 0 ? 'fail' : needsReviewCount > 0 ? 'review' : 'pass';
    enrichedMatrix[jid] = { ...j, confirmedViolations: confirmed, needsReview: needsReviewCount, reviewStatus };
  }

  // Compute aggregate summary counts
  let totalConfirmedViolations = 0;
  let totalNeedsReview = 0;
  let needsReviewJurisdictions = 0;
  for (const entry of Object.values(enrichedMatrix) as Array<{ confirmedViolations: number; needsReview: number; reviewStatus: string }>) {
    totalConfirmedViolations += entry.confirmedViolations;
    totalNeedsReview += entry.needsReview;
    if (entry.reviewStatus === 'review') needsReviewJurisdictions++;
  }

  return {
    summary: {
      ...compliance.summary,
      totalConfirmedViolations,
      totalNeedsReview,
      needsReview: needsReviewJurisdictions,
    },
    matrix: enrichedMatrix,
    issueAnnotations: annotationsObj,
  };
}

function buildNextSteps(compliance?: ComplianceEnrichment | null): readonly string[] {
  const steps: string[] = [];
  if (compliance) {
    steps.push('View your results in the luqen dashboard for trend tracking and team collaboration.');
    steps.push('Schedule recurring scans to catch regressions before they reach production.');
  } else {
    steps.push('Add compliance checking to see how your site maps to legal requirements: set LUQEN_COMPLIANCE_URL and re-run.');
    steps.push('View your results in the luqen dashboard for trend tracking.');
  }
  return steps;
}

export async function generateJsonReport(input: JsonReportInput): Promise<ScanReport> {
  const { siteUrl, pages, errors, outputDir, compliance } = input;
  const byLevel = { error: 0, warning: 0, notice: 0 };
  for (const page of pages) {
    for (const issue of page.issues) {
      if (issue.type in byLevel) byLevel[issue.type as keyof typeof byLevel]++;
    }
  }
  await mkdir(outputDir, { recursive: true });
  const timestamp = generateTimestamp();
  const reportPath = buildUniqueFilename(outputDir, siteUrl, timestamp, 'json');
  const report: ScanReport = {
    summary: { url: siteUrl, pagesScanned: pages.length, pagesFailed: errors.length, totalIssues: pages.reduce((sum, p) => sum + p.issueCount, 0), byLevel },
    pages: [...pages],
    errors: [...errors],
    reportPath,
  };

  // When compliance data is available, include it as a top-level field.
  const outputData: Record<string, unknown> = { ...report };
  if (compliance) {
    outputData['compliance'] = serializeCompliance(compliance, pages);
  }

  // Include template issues when present
  const { templateIssues } = buildAnnotatedPages(pages, compliance);
  if (templateIssues.length > 0) {
    outputData['templateIssues'] = templateIssues;
  }

  // Progressive discovery: suggest next steps based on current report content
  outputData['nextSteps'] = buildNextSteps(compliance);

  await writeFile(reportPath, JSON.stringify(outputData, null, 2), 'utf-8');
  return report;
}
