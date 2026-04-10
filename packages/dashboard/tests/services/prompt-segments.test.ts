import { describe, it, expect } from 'vitest';
import {
  parsePromptSegments,
  assembleTemplate,
  detectStaleOverride,
  type PromptSegment,
} from '../../src/services/prompt-segments.js';

// ─── parsePromptSegments ─────────────────────────────────────────────────────

describe('parsePromptSegments', () => {
  it('returns single editable segment for plain text', () => {
    const segments = parsePromptSegments('hello world');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: 'editable', content: 'hello world' });
  });

  it('parses locked + editable segments in order', () => {
    const template = 'A<!-- LOCKED:x -->L1<!-- /LOCKED -->B';
    const segments = parsePromptSegments(template);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: 'editable', content: 'A' });
    expect(segments[1]).toMatchObject({ type: 'locked', name: 'x', content: 'L1' });
    expect(segments[2]).toMatchObject({ type: 'editable', content: 'B' });
  });

  it('returns single editable fallback on unclosed fence', () => {
    const template = 'A<!-- LOCKED:x -->L1';
    const segments = parsePromptSegments(template);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: 'editable', content: template });
  });
});

// ─── assembleTemplate ────────────────────────────────────────────────────────

describe('assembleTemplate', () => {
  it('reassembles with interleaved locked + editable segments', () => {
    const defaultTemplate =
      "A<!-- LOCKED:sec-x -->L1<!-- /LOCKED -->B<!-- LOCKED:sec-y -->L2<!-- /LOCKED -->C";
    const defaultSegments = parsePromptSegments(defaultTemplate);
    const result = assembleTemplate({ defaultSegments, editableValues: ["A'", "B'", "C'"] });
    expect(result).toBe("A'<!-- LOCKED:sec-x -->L1<!-- /LOCKED -->B'<!-- LOCKED:sec-y -->L2<!-- /LOCKED -->C'");
  });

  it('throws when editableValues length != editable count', () => {
    const template = "Intro<!-- LOCKED:x -->L<!-- /LOCKED -->Tail";
    const segments = parsePromptSegments(template);
    // 2 editable segments (Intro, Tail), 1 locked
    // Providing 3 values should throw
    expect(() =>
      assembleTemplate({ defaultSegments: segments, editableValues: ['a', 'b', 'c'] })
    ).toThrow();
  });

  it('returns template unchanged when all segments are locked', () => {
    const template = "<!-- LOCKED:x -->L<!-- /LOCKED -->";
    const segments = parsePromptSegments(template);
    // 0 editable segments, editableValues = []
    const result = assembleTemplate({ defaultSegments: segments, editableValues: [] });
    expect(result).toBe("<!-- LOCKED:x -->L<!-- /LOCKED -->");
  });

  it('returns editable value when template has no locked segments', () => {
    const template = "some text";
    const segments = parsePromptSegments(template);
    const result = assembleTemplate({ defaultSegments: segments, editableValues: ['new text'] });
    expect(result).toBe('new text');
  });
});

// ─── detectStaleOverride ─────────────────────────────────────────────────────

describe('detectStaleOverride', () => {
  it('returns non-stale when override contains all default locked names', () => {
    const defaultTemplate =
      "Intro<!-- LOCKED:output-format -->FORMAT<!-- /LOCKED -->Tail";
    const defaultSegments = parsePromptSegments(defaultTemplate);
    const override =
      "My custom intro<!-- LOCKED:output-format -->FORMAT<!-- /LOCKED -->My custom tail";

    const result = detectStaleOverride(override, defaultSegments);
    expect(result.isStale).toBe(false);
    expect(result.missingLockNames).toHaveLength(0);
    expect(result.extractedEditables).toHaveLength(0);
  });

  it('returns stale when override is missing a locked block', () => {
    const defaultTemplate =
      "Intro<!-- LOCKED:output-format -->FORMAT<!-- /LOCKED -->Tail";
    const defaultSegments = parsePromptSegments(defaultTemplate);
    const override = "plain old override no fences";

    const result = detectStaleOverride(override, defaultSegments);
    expect(result.isStale).toBe(true);
    expect(result.missingLockNames).toContain('output-format');
    // extractedEditables has one entry = the whole override
    expect(result.extractedEditables).toHaveLength(1);
    expect(result.extractedEditables[0]).toBe(override);
  });

  it('returns non-stale for empty override (no override exists)', () => {
    const defaultTemplate =
      "Intro<!-- LOCKED:output-format -->FORMAT<!-- /LOCKED -->Tail";
    const defaultSegments = parsePromptSegments(defaultTemplate);

    const result = detectStaleOverride('', defaultSegments);
    expect(result.isStale).toBe(false);
    expect(result.missingLockNames).toHaveLength(0);
    expect(result.extractedEditables).toHaveLength(0);
  });

  it('returns non-stale for whitespace-only override', () => {
    const defaultTemplate =
      "Intro<!-- LOCKED:output-format -->FORMAT<!-- /LOCKED -->Tail";
    const defaultSegments = parsePromptSegments(defaultTemplate);

    const result = detectStaleOverride('   \n  ', defaultSegments);
    expect(result.isStale).toBe(false);
  });
});
