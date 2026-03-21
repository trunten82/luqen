import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyFix } from '../../src/fixer/fix-applier.js';
import type { FixProposal } from '../../src/types.js';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('applyFix', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = join(tmpdir(), `luqen-apply-test-${Date.now()}`); mkdirSync(tempDir, { recursive: true }); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('applies a fix and returns a diff', async () => {
    const filePath = join(tempDir, 'page.tsx');
    writeFileSync(filePath, '<div>\n  <img src="/photo.jpg">\n</div>');
    const fix: FixProposal = { file: filePath, line: 2, issue: 'WCAG2AA.H37', description: 'Add alt=""', oldText: '<img src="/photo.jpg">', newText: '<img alt="" src="/photo.jpg">', confidence: 'high' };
    const result = await applyFix(fix);
    expect(result.applied).toBe(true);
    expect(result.diff).toContain('-');
    expect(result.diff).toContain('+');
    expect(readFileSync(filePath, 'utf-8')).toContain('alt=""');
  });

  it('returns applied=false when old text not found', async () => {
    const filePath = join(tempDir, 'page.tsx');
    writeFileSync(filePath, '<div><h1>No match</h1></div>');
    const fix: FixProposal = { file: filePath, line: 1, issue: 'WCAG2AA.H37', description: 'Add alt=""', oldText: '<img src="/photo.jpg">', newText: '<img alt="" src="/photo.jpg">', confidence: 'high' };
    const result = await applyFix(fix);
    expect(result.applied).toBe(false);
  });
});
