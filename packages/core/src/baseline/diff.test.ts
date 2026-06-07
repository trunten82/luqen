import { describe, it, expect } from 'vitest';
import { diffBaseline, computeGateExitCode, type BaselineDiff } from './diff.js';
import { type BaselineFinding } from './baseline.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(
  overrides: Partial<BaselineFinding> & Pick<BaselineFinding, 'fingerprint'>,
): BaselineFinding {
  return {
    normalizedPath: '/page',
    code: 'WCAG2AA.Test',
    type: 'error',
    selector: '#selector',
    message: 'Test issue',
    ...overrides,
  };
}

const ERROR_FINDING = makeFinding({ fingerprint: 'fp-error-1', type: 'error' });
const WARNING_FINDING = makeFinding({ fingerprint: 'fp-warn-1', type: 'warning' });
const NOTICE_FINDING = makeFinding({ fingerprint: 'fp-notice-1', type: 'notice' });

// ---------------------------------------------------------------------------
// diffBaseline()
// ---------------------------------------------------------------------------

describe('diffBaseline()', () => {
  it('returns empty sets when baseline and current are both empty', () => {
    const diff = diffBaseline([], []);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.fixedFindings).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('classifies a finding in current but not baseline as new', () => {
    const diff = diffBaseline([], [ERROR_FINDING]);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0].fingerprint).toBe('fp-error-1');
    expect(diff.fixedFindings).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('classifies a finding in baseline but not current as fixed', () => {
    const diff = diffBaseline([ERROR_FINDING], []);
    expect(diff.fixedFindings).toHaveLength(1);
    expect(diff.fixedFindings[0].fingerprint).toBe('fp-error-1');
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('classifies a finding in both baseline and current as unchanged', () => {
    const diff = diffBaseline([ERROR_FINDING], [ERROR_FINDING]);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.unchanged[0].fingerprint).toBe('fp-error-1');
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.fixedFindings).toHaveLength(0);
  });

  it('correctly splits new, fixed, and unchanged across multiple findings', () => {
    const baseline = [ERROR_FINDING, WARNING_FINDING];
    const current = [ERROR_FINDING, NOTICE_FINDING];
    const diff = diffBaseline(baseline, current);
    // ERROR_FINDING is in both → unchanged
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.unchanged[0].fingerprint).toBe('fp-error-1');
    // WARNING_FINDING is in baseline but not current → fixed
    expect(diff.fixedFindings).toHaveLength(1);
    expect(diff.fixedFindings[0].fingerprint).toBe('fp-warn-1');
    // NOTICE_FINDING is in current but not baseline → new
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0].fingerprint).toBe('fp-notice-1');
  });

  it('returns immutable (readonly) arrays', () => {
    const diff = diffBaseline([ERROR_FINDING], [ERROR_FINDING]);
    // Type-level: the return type declares readonly arrays.
    // Runtime: we verify the object is as expected (TS enforces read-only statically).
    expect(Array.isArray(diff.newFindings)).toBe(true);
    expect(Array.isArray(diff.fixedFindings)).toBe(true);
    expect(Array.isArray(diff.unchanged)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeGateExitCode()
// ---------------------------------------------------------------------------

describe('computeGateExitCode()', () => {
  const cleanDiff: BaselineDiff = { newFindings: [], fixedFindings: [], unchanged: [ERROR_FINDING] };
  const newDiff: BaselineDiff = { newFindings: [ERROR_FINDING], fixedFindings: [], unchanged: [] };
  const newWarningDiff: BaselineDiff = { newFindings: [WARNING_FINDING], fixedFindings: [], unchanged: [] };
  const newNoticeDiff: BaselineDiff = { newFindings: [NOTICE_FINDING], fixedFindings: [], unchanged: [] };

  describe('mode: none', () => {
    it('returns 0 even when there are new findings (report-only)', () => {
      expect(computeGateExitCode('none', newDiff, [ERROR_FINDING], false)).toBe(0);
    });

    it('returns 0 when there are no findings', () => {
      expect(computeGateExitCode('none', cleanDiff, [], false)).toBe(0);
    });
  });

  describe('mode: new (default)', () => {
    it('returns 0 when diff has no new findings', () => {
      expect(computeGateExitCode('new', cleanDiff, [ERROR_FINDING], false)).toBe(0);
    });

    it('returns 1 when diff has one new error finding', () => {
      expect(computeGateExitCode('new', newDiff, [ERROR_FINDING], false)).toBe(1);
    });

    it('returns 1 when diff has one new warning finding (minSeverity=warning)', () => {
      expect(computeGateExitCode('new', newWarningDiff, [WARNING_FINDING], false, 'warning')).toBe(1);
    });

    it('returns 0 when the only new finding is a notice (notices never gate)', () => {
      expect(computeGateExitCode('new', newNoticeDiff, [NOTICE_FINDING], false)).toBe(0);
    });

    it('returns 0 when new findings only have warning type but minSeverity=error', () => {
      expect(computeGateExitCode('new', newWarningDiff, [WARNING_FINDING], false, 'error')).toBe(0);
    });
  });

  describe('mode: all', () => {
    it('returns 1 when any error-level finding exists regardless of baseline', () => {
      // all-mode ignores whether findings are new — it just looks at current scan
      const emptyNewDiff: BaselineDiff = { newFindings: [], fixedFindings: [], unchanged: [ERROR_FINDING] };
      expect(computeGateExitCode('all', emptyNewDiff, [ERROR_FINDING], false)).toBe(1);
    });

    it('returns 0 when current findings have only warnings/notices (minSeverity=error)', () => {
      const warnOnlyDiff: BaselineDiff = { newFindings: [], fixedFindings: [], unchanged: [WARNING_FINDING] };
      expect(computeGateExitCode('all', warnOnlyDiff, [WARNING_FINDING], false, 'error')).toBe(0);
    });

    it('returns 1 when current findings have errors in unchanged (all-mode ignores baseline)', () => {
      // Even if there are no new findings, all-mode fails on any error
      const unchangedErrorDiff: BaselineDiff = { newFindings: [], fixedFindings: [], unchanged: [ERROR_FINDING] };
      expect(computeGateExitCode('all', unchangedErrorDiff, [ERROR_FINDING], false)).toBe(1);
    });

    it('returns 0 when current findings are empty', () => {
      const emptyDiff: BaselineDiff = { newFindings: [], fixedFindings: [], unchanged: [] };
      expect(computeGateExitCode('all', emptyDiff, [], false)).toBe(0);
    });
  });

  describe('infra errors', () => {
    it('returns 2 (never 0 or 1) when infraError is true', () => {
      const code = computeGateExitCode('new', cleanDiff, [], true);
      expect(code).toBe(2);
    });

    it('returns 2 for mode=none with infraError', () => {
      // Even with none mode, infra error overrides to 2
      const code = computeGateExitCode('none', cleanDiff, [], true);
      expect(code).toBe(2);
    });

    it('returns 2 for mode=all with infraError', () => {
      const code = computeGateExitCode('all', cleanDiff, [ERROR_FINDING], true);
      expect(code).toBe(2);
    });
  });

  describe('notice findings', () => {
    it('a notice-type finding never moves the new decision to 1', () => {
      const noticeDiff: BaselineDiff = {
        newFindings: [NOTICE_FINDING],
        fixedFindings: [],
        unchanged: [],
      };
      expect(computeGateExitCode('new', noticeDiff, [NOTICE_FINDING], false)).toBe(0);
      expect(computeGateExitCode('all', noticeDiff, [NOTICE_FINDING], false)).toBe(0);
    });
  });
});
