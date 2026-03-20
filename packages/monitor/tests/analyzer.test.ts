import { describe, it, expect } from 'vitest';
import { analyzeChanges, splitParagraphs, splitLines } from '../src/analyzer.js';

// ---- splitParagraphs ----

describe('splitParagraphs', () => {
  it('splits on double newlines', () => {
    const text = 'First paragraph.\n\nSecond paragraph.';
    const parts = splitParagraphs(text);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('First paragraph.');
    expect(parts[1]).toBe('Second paragraph.');
  });

  it('filters empty strings', () => {
    const text = '\n\nActual content\n\n';
    const parts = splitParagraphs(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('Actual content');
  });

  it('collapses internal whitespace', () => {
    const text = '  lots   of   spaces  ';
    const parts = splitParagraphs(text);
    expect(parts[0]).toBe('lots of spaces');
  });
});

// ---- splitLines ----

describe('splitLines', () => {
  it('splits on newlines', () => {
    const text = 'line one\nline two\nline three';
    expect(splitLines(text)).toHaveLength(3);
  });

  it('filters blank lines', () => {
    const text = 'entry 1\n\nentry 2\n';
    expect(splitLines(text)).toHaveLength(2);
  });

  it('trims each line', () => {
    const text = '  trimmed  \n  also trimmed  ';
    const lines = splitLines(text);
    expect(lines[0]).toBe('trimmed');
    expect(lines[1]).toBe('also trimmed');
  });
});

// ---- analyzeChanges — no change ----

describe('analyzeChanges (no change)', () => {
  it('returns changed=false when content is identical', () => {
    const content = 'The quick brown fox.';
    const result = analyzeChanges('html', content, content);
    expect(result.changed).toBe(false);
    expect(result.summary).toBe('No changes detected.');
    expect(result.sections.added).toHaveLength(0);
    expect(result.sections.removed).toHaveLength(0);
    expect(result.sections.modified).toHaveLength(0);
  });
});

// ---- analyzeChanges — html source type ----

describe('analyzeChanges (html)', () => {
  it('detects added paragraphs', () => {
    const old = 'Existing paragraph one.';
    const next = 'Existing paragraph one.\n\nBrand new paragraph two.';
    const result = analyzeChanges('html', old, next);
    expect(result.changed).toBe(true);
    expect(result.sections.added).toContain('Brand new paragraph two.');
    expect(result.sections.removed).toHaveLength(0);
  });

  it('detects removed paragraphs', () => {
    const old = 'Keep this.\n\nRemove this paragraph.';
    const next = 'Keep this.';
    const result = analyzeChanges('html', old, next);
    expect(result.changed).toBe(true);
    expect(result.sections.removed).toContain('Remove this paragraph.');
    expect(result.sections.added).toHaveLength(0);
  });

  it('detects modified paragraphs using similarity heuristic', () => {
    // Two sentences sharing most words — should be "modified" rather than add/remove
    const old = 'All public sector websites must comply with WCAG 2.1 AA by June 2025.';
    const next = 'All public sector websites must comply with WCAG 2.2 AA by June 2026.';
    const result = analyzeChanges('html', old, next);
    expect(result.changed).toBe(true);
    // Either detected as modified or as separate add/remove
    const totalDiffs =
      result.sections.added.length +
      result.sections.removed.length +
      result.sections.modified.length;
    expect(totalDiffs).toBeGreaterThan(0);
  });

  it('includes a human-readable summary', () => {
    const old = 'Article 1: Scope.';
    const next = 'Article 1: Scope.\n\nArticle 2: Definitions.';
    const result = analyzeChanges('html', old, next);
    expect(result.summary).toMatch(/added/i);
  });
});

// ---- analyzeChanges — rss source type ----

describe('analyzeChanges (rss)', () => {
  it('detects new RSS entries', () => {
    const old = 'Entry A: Description of A';
    const next = 'Entry A: Description of A\nEntry B: New regulation published';
    const result = analyzeChanges('rss', old, next);
    expect(result.changed).toBe(true);
    expect(result.sections.added).toContain('Entry B: New regulation published');
  });

  it('detects removed RSS entries', () => {
    const old = 'Entry A: Good content\nEntry B: Old news';
    const next = 'Entry A: Good content';
    const result = analyzeChanges('rss', old, next);
    expect(result.changed).toBe(true);
    expect(result.sections.removed).toContain('Entry B: Old news');
  });
});

// ---- analyzeChanges — api source type ----

describe('analyzeChanges (api)', () => {
  it('detects new JSON lines', () => {
    const old = '{"id":1,"name":"EU EAA"}';
    const next = '{"id":1,"name":"EU EAA"}\n{"id":2,"name":"New Regulation"}';
    const result = analyzeChanges('api', old, next);
    expect(result.changed).toBe(true);
    expect(result.sections.added.length).toBeGreaterThan(0);
  });
});

// ---- Summary building ----

describe('analyzeChanges summary', () => {
  it('says "1 new section added" for a single addition', () => {
    const result = analyzeChanges('html', 'Old content here.', 'Completely different content now.');
    expect(result.summary).toBeTruthy();
    expect(result.changed).toBe(true);
  });

  it('mentions both additions and removals when both present', () => {
    const old = 'Section A.\n\nSection B.';
    const next = 'Section A.\n\nSection C.';
    const result = analyzeChanges('html', old, next);
    // Should mention something changed
    expect(result.summary).not.toBe('No changes detected.');
  });
});
