/**
 * Phase 88 Plan 17 (W2, FP-11): filterDismissedIssues is the list-shape filter
 * dashboard_query_issues needs for the `issues` / `results[].issues` shapes it reads,
 * which applyDismissals (pages + templateIssues only) never touches. It is built on
 * the module's one matcher, so these cases pin the matching rules shared with it.
 */
import { describe, it, expect } from 'vitest';
import {
  filterDismissedIssues,
  type DismissalMatch,
} from '../../../src/services/issue-dismissals/apply-dismissals.js';

const SITE = 'https://fabrikam.example/shop';
const OTHER_SITE = 'https://fabrikam.example/blog';

// Factories: a mutation in one test can never leak into another.
const issue = (code: string, selector: string) => ({ type: 'error', code, message: code, selector, context: '' });
const dismissal = (code: string, selector: string, siteKey: string = SITE): DismissalMatch => ({
  id: `d-${code}-${selector}-${siteKey}`,
  code,
  selector,
  siteKey,
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('filterDismissedIssues', () => {
  it('filterDismissedIssues removes issues whose code and selector match an active dismissal of this site', () => {
    const issues = [issue('C1', '#a'), issue('C1', '#b'), issue('C2', '#a')];
    const kept = filterDismissedIssues(issues, [dismissal('C1', '#a')], SITE);

    expect(kept).toEqual([issue('C1', '#b'), issue('C2', '#a')]);
  });

  it('filterDismissedIssues returns the same array when nothing matches', () => {
    const issues = [issue('C1', '#a'), issue('C2', '#b')];

    expect(filterDismissedIssues(issues, [dismissal('C1', '#zzz')], SITE)).toBe(issues);
    expect(filterDismissedIssues(issues, [], SITE)).toBe(issues);
  });

  it('filterDismissedIssues ignores a dismissal recorded for another site key', () => {
    const issues = [issue('C1', '#a')];

    expect(filterDismissedIssues(issues, [dismissal('C1', '#a', OTHER_SITE)], SITE)).toBe(issues);
  });

  it('filterDismissedIssues never mutates a deep-frozen input', () => {
    const issues = deepFreeze([issue('C1', '#a'), issue('C1', '#b')]);
    const dismissals = deepFreeze([dismissal('C1', '#a')]);

    const kept = filterDismissedIssues(issues, dismissals, SITE);

    expect(kept).toEqual([issue('C1', '#b')]);
    expect(issues).toHaveLength(2);
  });

  it('filterDismissedIssues matches code and selector byte-exactly', () => {
    const issues = [issue('C1', '#a'), issue('c1', '#a'), issue('C1', '#A'), issue('C1', '#a ')];

    expect(filterDismissedIssues(issues, [dismissal('C1', '#a')], SITE)).toEqual([
      issue('c1', '#a'),
      issue('C1', '#A'),
      issue('C1', '#a '),
    ]);
  });

  it('filterDismissedIssues keeps entries that are not issue objects', () => {
    const entries: unknown[] = [null, 'text', 3, { code: 'C1' }, issue('C1', '#a')];

    expect(filterDismissedIssues(entries, [dismissal('C1', '#a')], SITE)).toEqual([null, 'text', 3, { code: 'C1' }]);
  });
});
