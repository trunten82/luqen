import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateHtmlReport } from '../../src/reporter/html-reporter.js';
import type { PageResult, ScanError } from '../../src/types.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('generateHtmlReport', () => {
  let outputDir: string;
  beforeEach(() => { outputDir = join(tmpdir(), `pally-html-test-${Date.now()}`); mkdirSync(outputDir, { recursive: true }); });
  afterEach(() => { rmSync(outputDir, { recursive: true, force: true }); });

  const pages: PageResult[] = [
    { url: 'https://example.com/', discoveryMethod: 'sitemap', issueCount: 1, issues: [
      { code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
    ]},
  ];
  const errors: ScanError[] = [];

  it('generates a self-contained HTML file with no external references', async () => {
    const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    expect(existsSync(reportPath)).toBe(true);
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).not.toMatch(/<script\s+src=/);
    expect(html).not.toMatch(/<link\s+.*href=.*\.css/);
    expect(html).toMatch(/\d+\s+pages?\s+scanned/i);
    expect(html).toContain('https://example.com/');
    expect(html).toContain('page-section');
  });

  it('includes summary card with page count', async () => {
    const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('summary-card');
    expect(html).toContain('Pages Scanned');
  });

  it('has collapsible page sections', async () => {
    const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('page-header');
    expect(html).toContain('page-body');
    expect(html).toContain('toggleSection');
  });

  it('does not overwrite existing report files', async () => {
    const path1 = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    await new Promise((r) => setTimeout(r, 10));
    const path2 = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    expect(path1).not.toBe(path2);
    expect(existsSync(path1)).toBe(true);
    expect(existsSync(path2)).toBe(true);
  });
});
