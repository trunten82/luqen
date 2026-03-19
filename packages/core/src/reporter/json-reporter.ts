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
 * Serialize a ComplianceEnrichment for JSON output.
 * The issueAnnotations Map must be converted to a plain object.
 */
function serializeCompliance(compliance: ComplianceEnrichment): Record<string, unknown> {
  const annotationsObj: Record<string, unknown> = {};
  for (const [key, value] of compliance.issueAnnotations) {
    annotationsObj[key] = value;
  }
  return {
    summary: compliance.summary,
    matrix: compliance.matrix,
    issueAnnotations: annotationsObj,
  };
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
    outputData['compliance'] = serializeCompliance(compliance);
  }

  // Include template issues when present
  const { templateIssues } = buildAnnotatedPages(pages, compliance);
  if (templateIssues.length > 0) {
    outputData['templateIssues'] = templateIssues;
  }

  await writeFile(reportPath, JSON.stringify(outputData, null, 2), 'utf-8');
  return report;
}
