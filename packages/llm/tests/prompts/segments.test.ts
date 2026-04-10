import { describe, it, expect } from 'vitest';
import {
  parsePromptSegments,
  validateOverride,
  LOCKED_SECTION_EXPLANATIONS,
  type PromptSegment,
  type ValidationResult,
} from '../../src/prompts/segments.js';

// ─── parsePromptSegments ────────────────────────────────────────────────────

describe('parsePromptSegments', () => {
  it('plain string with no fences → single editable segment', () => {
    const result = parsePromptSegments('Hello world');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'editable', content: 'Hello world' });
  });

  it('single locked block → [editable-before, locked, editable-after]', () => {
    const template = 'Before\n<!-- LOCKED:output-format -->\nThe format\n<!-- /LOCKED -->\nAfter';
    const result = parsePromptSegments(template);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'editable', content: 'Before\n' });
    expect(result[1]).toMatchObject({ type: 'locked', name: 'output-format' });
    expect((result[1] as PromptSegment).content).toContain('The format');
    expect(result[2]).toEqual({ type: 'editable', content: '\nAfter' });
  });

  it('segment content does NOT include the fence markers themselves', () => {
    const template = '<!-- LOCKED:output-format -->\ncontent here\n<!-- /LOCKED -->';
    const result = parsePromptSegments(template);
    const locked = result.find((s) => s.type === 'locked');
    expect(locked?.content).not.toContain('<!-- LOCKED');
    expect(locked?.content).not.toContain('<!-- /LOCKED -->');
    expect(locked?.content).toBe('\ncontent here\n');
  });

  it('multiple locked blocks → correct interleaved order', () => {
    const template = [
      'Preamble',
      '<!-- LOCKED:output-format -->',
      'Format section',
      '<!-- /LOCKED -->',
      'Middle',
      '<!-- LOCKED:variable-injection -->',
      'Variables here',
      '<!-- /LOCKED -->',
      'End',
    ].join('\n');

    const result = parsePromptSegments(template);
    const lockedNames = result.filter((s) => s.type === 'locked').map((s) => s.name);
    expect(lockedNames).toEqual(['output-format', 'variable-injection']);
    expect(result[0]?.type).toBe('editable');
    expect(result[2]?.type).toBe('editable');
    expect(result[4]?.type).toBe('editable');
  });

  it('locked block at start → no empty editable segment before it', () => {
    const template = '<!-- LOCKED:output-format -->\ncontent\n<!-- /LOCKED -->\nAfter';
    const result = parsePromptSegments(template);
    expect(result[0]?.type).toBe('locked');
    const editables = result.filter((s) => s.type === 'editable');
    expect(editables.every((s) => s.content.length > 0)).toBe(true);
  });

  it('locked block at end → no empty editable segment after it', () => {
    const template = 'Before\n<!-- LOCKED:output-format -->\ncontent\n<!-- /LOCKED -->';
    const result = parsePromptSegments(template);
    const last = result[result.length - 1];
    expect(last?.type).toBe('locked');
    const editables = result.filter((s) => s.type === 'editable');
    expect(editables.every((s) => s.content.length > 0)).toBe(true);
  });

  it('unclosed LOCKED fence → graceful fallback: entire template as single editable', () => {
    const template = 'Start\n<!-- LOCKED:output-format -->\nunclosed content';
    const result = parsePromptSegments(template);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'editable', content: template });
  });

  it('malformed fence (missing name) → treated as plain text, whole template as editable', () => {
    const template = '<!-- LOCKED: -->\ncontent\n<!-- /LOCKED -->';
    const result = parsePromptSegments(template);
    // Names must be kebab-case (letters, digits, hyphens only — not empty)
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('editable');
  });

  it('editable segment with no content is not emitted', () => {
    // Two adjacent locked blocks with no text between
    const template = '<!-- LOCKED:output-format -->\nA\n<!-- /LOCKED --><!-- LOCKED:variable-injection -->\nB\n<!-- /LOCKED -->';
    const result = parsePromptSegments(template);
    const editables = result.filter((s) => s.type === 'editable');
    expect(editables.every((s) => s.content.length > 0)).toBe(true);
  });
});

// ─── validateOverride ───────────────────────────────────────────────────────

const DEFAULT_WITH_TWO_LOCKS = [
  'Preamble text',
  '<!-- LOCKED:output-format -->',
  '\nJSON schema here\n',
  '<!-- /LOCKED -->',
  'Middle text',
  '<!-- LOCKED:variable-injection -->',
  '\n{{variable}} content\n',
  '<!-- /LOCKED -->',
  'End text',
].join('');

describe('validateOverride', () => {
  it('identical templates → ok:true, no violations', () => {
    const result = validateOverride(DEFAULT_WITH_TWO_LOCKS, DEFAULT_WITH_TWO_LOCKS);
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('override has same locked blocks byte-identical in same order → ok:true', () => {
    const override = DEFAULT_WITH_TWO_LOCKS.replace('Middle text', 'Custom middle text');
    const result = validateOverride(override, DEFAULT_WITH_TWO_LOCKS);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('override missing block A → violation with reason missing', () => {
    const override = DEFAULT_WITH_TWO_LOCKS
      .replace('<!-- LOCKED:output-format -->\nJSON schema here\n<!-- /LOCKED -->', '');
    const result = validateOverride(override, DEFAULT_WITH_TWO_LOCKS);
    expect(result.ok).toBe(false);
    const v = result.violations.find((v) => v.name === 'output-format');
    expect(v?.reason).toBe('missing');
  });

  it('override block A content changed by one byte → violation with reason modified', () => {
    const override = DEFAULT_WITH_TWO_LOCKS.replace(
      '<!-- LOCKED:output-format -->\nJSON schema here\n<!-- /LOCKED -->',
      '<!-- LOCKED:output-format -->\nJSON schema hereX\n<!-- /LOCKED -->',
    );
    const result = validateOverride(override, DEFAULT_WITH_TWO_LOCKS);
    expect(result.ok).toBe(false);
    const v = result.violations.find((v) => v.name === 'output-format');
    expect(v?.reason).toBe('modified');
  });

  it('override has block renamed → original missing violation', () => {
    const override = DEFAULT_WITH_TWO_LOCKS.replace(
      '<!-- LOCKED:output-format -->',
      '<!-- LOCKED:output-format-renamed -->',
    ).replace(
      // Fix the /LOCKED for the renamed block — still content is same just name differs
      '<!-- /LOCKED -->\nMiddle',
      '<!-- /LOCKED -->\nMiddle',
    );
    const result = validateOverride(override, DEFAULT_WITH_TWO_LOCKS);
    expect(result.ok).toBe(false);
    const v = result.violations.find((v) => v.name === 'output-format');
    expect(v?.reason).toBe('missing');
  });

  it('override has blocks in wrong order → reordered violation', () => {
    // Swap the two locked blocks
    const override = [
      'Preamble text',
      '<!-- LOCKED:variable-injection -->',
      '\n{{variable}} content\n',
      '<!-- /LOCKED -->',
      'Middle text',
      '<!-- LOCKED:output-format -->',
      '\nJSON schema here\n',
      '<!-- /LOCKED -->',
      'End text',
    ].join('');
    const result = validateOverride(override, DEFAULT_WITH_TWO_LOCKS);
    expect(result.ok).toBe(false);
    const reasons = result.violations.map((v) => v.reason);
    expect(reasons.some((r) => r === 'reordered')).toBe(true);
  });

  it('default has no locked blocks → always ok:true', () => {
    const result = validateOverride('anything', 'plain default with no locks');
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('override has extra locked blocks not in default → violations array only covers default locks', () => {
    const override = DEFAULT_WITH_TWO_LOCKS + '\n<!-- LOCKED:extra-block -->\nextra\n<!-- /LOCKED -->';
    const result = validateOverride(override, DEFAULT_WITH_TWO_LOCKS);
    // Extra block not in default — should NOT cause a violation
    expect(result.ok).toBe(true);
  });

  it('each name appears at most once in violations (deduped)', () => {
    // Override missing both blocks
    const override = 'Just plain text with no locked blocks';
    const result = validateOverride(override, DEFAULT_WITH_TWO_LOCKS);
    expect(result.ok).toBe(false);
    const names = result.violations.map((v) => v.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

// ─── LOCKED_SECTION_EXPLANATIONS ────────────────────────────────────────────

describe('LOCKED_SECTION_EXPLANATIONS', () => {
  it('has an entry for output-format', () => {
    expect(LOCKED_SECTION_EXPLANATIONS['output-format']).toBeTruthy();
    const explanation = LOCKED_SECTION_EXPLANATIONS['output-format'];
    expect(typeof explanation).toBe('string');
    expect(explanation.length).toBeGreaterThan(10);
  });

  it('output-format explanation mentions JSON or schema', () => {
    const explanation = LOCKED_SECTION_EXPLANATIONS['output-format'] ?? '';
    const lower = explanation.toLowerCase();
    expect(lower.includes('json') || lower.includes('schema')).toBe(true);
  });

  it('has an entry for variable-injection', () => {
    expect(LOCKED_SECTION_EXPLANATIONS['variable-injection']).toBeTruthy();
    const explanation = LOCKED_SECTION_EXPLANATIONS['variable-injection'];
    expect(typeof explanation).toBe('string');
    expect(explanation.length).toBeGreaterThan(10);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(LOCKED_SECTION_EXPLANATIONS)).toBe(true);
  });

  it('unknown key returns undefined (not a crash)', () => {
    const val = LOCKED_SECTION_EXPLANATIONS['unknown-section'];
    expect(val).toBeUndefined();
  });
});
