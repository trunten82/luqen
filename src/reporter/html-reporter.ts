import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import type { PageResult, ScanError, ScanSummary } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface HtmlReportInput {
  readonly siteUrl: string;
  readonly pages: readonly PageResult[];
  readonly errors: readonly ScanError[];
  readonly outputDir: string;
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

export async function generateHtmlReport(input: HtmlReportInput): Promise<string> {
  const { siteUrl, pages, errors, outputDir } = input;
  const byLevel = { error: 0, warning: 0, notice: 0 };
  for (const page of pages) {
    for (const issue of page.issues) {
      if (issue.type in byLevel) byLevel[issue.type]++;
    }
  }
  const summary: ScanSummary = {
    url: siteUrl,
    pagesScanned: pages.length,
    pagesFailed: errors.length,
    totalIssues: pages.reduce((sum, p) => sum + p.issueCount, 0),
    byLevel,
  };

  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('issuesByType', (issues: readonly { type: string }[], type: string) =>
    issues.some((i) => i.type === type),
  );
  Handlebars.registerHelper('countByType', (issues: readonly { type: string }[], type: string) =>
    issues.filter((i) => i.type === type).length,
  );

  const templateSource = await readFile(join(__dirname, 'report.hbs'), 'utf-8');
  const template = Handlebars.compile(templateSource);
  const html = template({ summary, pages, errors });

  await mkdir(outputDir, { recursive: true });
  const timestamp = generateTimestamp();
  const reportPath = buildUniqueFilename(outputDir, timestamp);
  await writeFile(reportPath, html, 'utf-8');
  return reportPath;
}
