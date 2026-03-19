import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mapIssuesToSource } from '../../src/source-mapper/source-mapper.js';
import type { PageResult } from '../../src/types.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('mapIssuesToSource', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `pally-map-test-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'next.config.js'), 'module.exports = {}');
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
    mkdirSync(join(repoDir, 'app', 'about'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'about', 'page.tsx'), '<div>\n  <img src="/photo.jpg" />\n  <h1>About</h1>\n</div>');
    mkdirSync(join(repoDir, 'app'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'page.tsx'), '<div><h1>Home</h1></div>');
  });

  afterEach(() => { rmSync(repoDir, { recursive: true, force: true }); });

  it('maps page issues to source file with line numbers', async () => {
    const pages: PageResult[] = [{
      url: 'https://example.com/about', discoveryMethod: 'sitemap', issueCount: 1,
      issues: [{ code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' }],
    }];
    const result = await mapIssuesToSource(pages, repoDir, {});
    expect(result[0].sourceMap).toBeDefined();
    expect(result[0].sourceMap!.file).toContain('page.tsx');
    expect(result[0].sourceMap!.confidence).not.toBe('none');
  });

  it('uses sourceMap overrides', async () => {
    const overridePath = join(repoDir, 'custom', 'template.tsx');
    mkdirSync(join(repoDir, 'custom'), { recursive: true });
    writeFileSync(overridePath, '<div><img src="/x.jpg" /></div>');
    const pages: PageResult[] = [{
      url: 'https://example.com/about', discoveryMethod: 'sitemap', issueCount: 1,
      issues: [{ code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' }],
    }];
    const result = await mapIssuesToSource(pages, repoDir, { '/about': 'custom/template.tsx' });
    expect(result[0].sourceMap!.file).toContain('custom/template.tsx');
  });

  it('returns pages without sourceMap when no file found', async () => {
    const pages: PageResult[] = [{
      url: 'https://example.com/nonexistent', discoveryMethod: 'crawl', issueCount: 1,
      issues: [{ code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' }],
    }];
    const result = await mapIssuesToSource(pages, repoDir, {});
    expect(result[0].sourceMap).toBeUndefined();
  });

  it('uses wildcard override matching /*', async () => {
    const overridePath = join(repoDir, 'custom', 'template.tsx');
    mkdirSync(join(repoDir, 'custom'), { recursive: true });
    writeFileSync(overridePath, '<div><img src="/x.jpg" /></div>');
    const pages: PageResult[] = [{
      url: 'https://example.com/about/section', discoveryMethod: 'sitemap', issueCount: 1,
      issues: [{ code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' }],
    }];
    const result = await mapIssuesToSource(pages, repoDir, { '/about/*': 'custom/template.tsx' });
    expect(result[0].sourceMap!.file).toContain('custom/template.tsx');
  });

  it('returns high confidence sourceMap when page has no issues', async () => {
    const pages: PageResult[] = [{
      url: 'https://example.com/about', discoveryMethod: 'sitemap', issueCount: 0,
      issues: [],
    }];
    const result = await mapIssuesToSource(pages, repoDir, {});
    expect(result[0].sourceMap).toBeDefined();
    expect(result[0].sourceMap!.confidence).toBe('high');
  });

  it('ignores override when override file does not exist on disk', async () => {
    const pages: PageResult[] = [{
      url: 'https://example.com/about', discoveryMethod: 'sitemap', issueCount: 0,
      issues: [],
    }];
    const result = await mapIssuesToSource(pages, repoDir, { '/about': 'nonexistent/file.tsx' });
    // Should fall back to no sourceMap since override file doesn't exist
    expect(result[0].sourceMap).toBeUndefined();
  });
});
