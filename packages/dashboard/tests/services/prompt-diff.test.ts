/**
 * Unit tests for the prompt-diff service.
 * TDD: Tests written before implementation.
 */

import { describe, it, expect } from 'vitest';
import { computePromptDiff } from '../../src/services/prompt-diff.js';

// Prompt templates almost always end with a newline — use consistent fixtures.
const ALPHA_BETA = 'alpha\nbeta\n';
const ALPHA_BETA_GAMMA = 'alpha\nbeta\ngamma\n';

describe('computePromptDiff', () => {
  it('returns all context lines when inputs are identical', () => {
    const text = 'line one\nline two\nline three\n';
    const result = computePromptDiff(text, text);
    expect(result.length).toBeGreaterThan(0);
    for (const line of result) {
      expect(line.type).toBe('context');
    }
  });

  it('returns context lines plus an add when one line is appended', () => {
    const result = computePromptDiff(ALPHA_BETA, ALPHA_BETA_GAMMA);
    const adds = result.filter((l) => l.type === 'add');
    expect(adds.length).toBeGreaterThan(0);
    const addTexts = adds.map((l) => l.text);
    expect(addTexts).toContain('gamma');
  });

  it('returns context lines plus a remove when one line is deleted', () => {
    const result = computePromptDiff(ALPHA_BETA_GAMMA, ALPHA_BETA);
    const removes = result.filter((l) => l.type === 'remove');
    expect(removes.length).toBeGreaterThan(0);
    const removeTexts = removes.map((l) => l.text);
    expect(removeTexts).toContain('gamma');
  });

  it('returns both adds and removes for completely different text', () => {
    const result = computePromptDiff('foo\nbar\n', 'baz\nqux\n');
    const adds = result.filter((l) => l.type === 'add');
    const removes = result.filter((l) => l.type === 'remove');
    expect(adds.length).toBeGreaterThan(0);
    expect(removes.length).toBeGreaterThan(0);
  });

  it('returns all adds when oldText is empty', () => {
    const result = computePromptDiff('', 'line one\nline two\n');
    expect(result.length).toBeGreaterThan(0);
    for (const line of result) {
      expect(line.type).toBe('add');
    }
  });

  it('returns all removes when newText is empty', () => {
    const result = computePromptDiff('line one\nline two\n', '');
    expect(result.length).toBeGreaterThan(0);
    for (const line of result) {
      expect(line.type).toBe('remove');
    }
  });

  it('returns raw unescaped text — no HTML entities in output', () => {
    const text = 'say <hello> & "world"\n';
    const result = computePromptDiff(text, text);
    for (const line of result) {
      expect(line.text).not.toContain('&lt;');
      expect(line.text).not.toContain('&gt;');
      expect(line.text).not.toContain('&amp;');
      expect(line.text).not.toContain('&quot;');
    }
  });

  it('each DiffLine represents exactly one line — no embedded newlines', () => {
    const text = 'line one\nline two\nline three\n';
    const result = computePromptDiff(text, text);
    for (const line of result) {
      expect(line.text).not.toContain('\n');
    }
  });

  it('type property is always one of the three valid values', () => {
    const result = computePromptDiff('a\nb\n', 'a\nc\n');
    for (const line of result) {
      expect(['add', 'remove', 'context']).toContain(line.type);
    }
  });

  it('context lines contain the actual shared text content', () => {
    const result = computePromptDiff('shared\nchanged line\n', 'shared\nnew line\n');
    const contextLines = result.filter((l) => l.type === 'context');
    const contextTexts = contextLines.map((l) => l.text);
    expect(contextTexts).toContain('shared');
  });
});
