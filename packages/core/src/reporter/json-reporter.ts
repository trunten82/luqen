import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PageResult, ScanError, ScanReport } from '../types.js';

interface JsonReportInput {
  readonly siteUrl: string;
  readonly pages: readonly PageResult[];
  readonly errors: readonly ScanError[];
  readonly outputDir: string;
}

function generateTimestamp(): string {
  return new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
}

function buildUniqueFilename(outputDir: string, timestamp: string): string {
  let filename = `pally-report-${timestamp}.json`;
  let fullPath = join(outputDir, filename);
  let counter = 1;
  while (existsSync(fullPath)) {
    filename = `pally-report-${timestamp}-${counter}.json`;
    fullPath = join(outputDir, filename);
    counter++;
  }
  return fullPath;
}

export async function generateJsonReport(input: JsonReportInput): Promise<ScanReport> {
  const { siteUrl, pages, errors, outputDir } = input;
  const byLevel = { error: 0, warning: 0, notice: 0 };
  for (const page of pages) {
    for (const issue of page.issues) {
      if (issue.type in byLevel) byLevel[issue.type]++;
    }
  }
  await mkdir(outputDir, { recursive: true });
  const timestamp = generateTimestamp();
  const reportPath = buildUniqueFilename(outputDir, timestamp);
  const report: ScanReport = {
    summary: { url: siteUrl, pagesScanned: pages.length, pagesFailed: errors.length, totalIssues: pages.reduce((sum, p) => sum + p.issueCount, 0), byLevel },
    pages: [...pages],
    errors: [...errors],
    reportPath,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  return report;
}
