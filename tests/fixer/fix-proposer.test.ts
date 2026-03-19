import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { proposeFixesFromReport } from '../../src/fixer/fix-proposer.js';
import type { ScanReport } from '../../src/types.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('proposeFixesFromReport', () => {
  let repoDir: string;
  beforeEach(() => {
    repoDir = join(tmpdir(), `pally-fix-test-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'next.config.js'), '');
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
    mkdirSync(join(repoDir, 'app', 'about'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'about', 'page.tsx'), '<div>\n  <img src="/photo.jpg">\n  <h1>About</h1>\n</div>');
    mkdirSync(join(repoDir, 'app'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'page.tsx'), '<div><h1>Home</h1></div>');
  });
  afterEach(() => { rmSync(repoDir, { recursive: true, force: true }); });

  it('proposes fixes for img missing alt', async () => {
    const report: ScanReport = {
      summary: { url: 'https://example.com', pagesScanned: 1, pagesFailed: 0, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
      pages: [{ url: 'https://example.com/about', discoveryMethod: 'sitemap', issueCount: 1,
        issues: [{ code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', type: 'error', message: 'Img element missing an alt attribute', selector: 'img', context: '<img src="/photo.jpg">' }] }],
      errors: [], reportPath: '/tmp/report.json',
    };
    const result = await proposeFixesFromReport(report, repoDir, {});
    expect(result.fixable).toBeGreaterThanOrEqual(1);
    expect(result.fixes[0].newText).toContain('alt=""');
  });

  it('counts unfixable issues', async () => {
    const report: ScanReport = {
      summary: { url: 'https://example.com', pagesScanned: 1, pagesFailed: 0, totalIssues: 1, byLevel: { error: 0, warning: 1, notice: 0 } },
      pages: [{ url: 'https://example.com/about', discoveryMethod: 'sitemap', issueCount: 1,
        issues: [{ code: 'WCAG2AA.SomeUnknownRule', type: 'warning', message: 'Unknown', selector: 'div', context: '<div>text</div>' }] }],
      errors: [], reportPath: '/tmp/report.json',
    };
    const result = await proposeFixesFromReport(report, repoDir, {});
    expect(result.unfixable).toBe(1);
  });
});
