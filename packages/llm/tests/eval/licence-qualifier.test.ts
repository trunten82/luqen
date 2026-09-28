/**
 * `licence-qualifier.test.ts` — Phase 86 Task 2 (T-86-07).
 *
 * `buildLicenceQualifier` is the SOLE constructor of `LicenceQualifier`. This
 * file pins its two shapes against the REAL loaded bar file (never a
 * hand-written expectation of the bar's own content), and separately proves
 * the zero-clause throw against a scratch, uncommitted bar-like object whose
 * `licenceStrings` deliberately carries none of the unmeasured-instability
 * fragment.
 */
import { describe, it, expect } from 'vitest';
import { loadDecisionBars, type LoadedDecisionBars } from '../../src/eval/decision-bars.js';
import {
  buildLicenceQualifier,
  UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT,
  LicenceQualifierNoSupersededClausesFoundError,
} from '../../src/eval/licence-qualifier.js';

const PACKAGE_ROOT = process.cwd();

/**
 * A test-local, independent walk over `bar.licenceStrings` -- deliberately
 * NEVER imported from the module under test, so this pin cannot be made to
 * agree with `licence-qualifier.ts` by construction. Used only for the
 * "and no others" half of the presence pin below.
 */
function findAllOccurrencesOfFragment(value: unknown, fragment: string, pathPrefix: string): string[] {
  if (typeof value === 'string') {
    return value.includes(fragment) ? [pathPrefix] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findAllOccurrencesOfFragment(item, fragment, `${pathPrefix}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      findAllOccurrencesOfFragment(child, fragment, `${pathPrefix}.${key}`),
    );
  }
  return [];
}

describe('UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT — pinned against the REAL loaded bar (T-86-07)', () => {
  it('is present, verbatim, in exactly the three known PASS licence surfaces, and no others', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');

    // The three surfaces the plan names by dotted path.
    expect(bar.licenceStrings.falsePassGate.pass.additionalCaveatRequiredOnEveryPass).toContain(
      UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT,
    );
    expect(bar.licenceStrings.nonInferiorityClause.generateFix.pass.text).toContain(
      UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT,
    );
    expect(bar.licenceStrings.nonInferiorityClause.analyseVisualCorrect.pass.text).toContain(
      UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT,
    );

    // "and no others" -- a TEST-LOCAL recursive walk, independent of the
    // module under test (AMD-1: buildLicenceQualifier now scopes its own
    // walk to one subtree, so this pin can no longer read the count off
    // buildLicenceQualifier's own output -- see L1 below for that).
    const allOccurrences = findAllOccurrencesOfFragment(
      bar.licenceStrings,
      UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT,
      'licenceStrings',
    );
    expect(allOccurrences.sort()).toEqual(
      [
        'licenceStrings.falsePassGate.pass.additionalCaveatRequiredOnEveryPass',
        'licenceStrings.nonInferiorityClause.generateFix.pass.text',
        'licenceStrings.nonInferiorityClause.analyseVisualCorrect.pass.text',
      ].sort(),
    );
  });

  it('a measured qualifier supersedes only its own capability non-inferiority clause and never a false-PASS clause', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');

    const gfQualifier = buildLicenceQualifier({ state: 'measured', value: 0.42 }, 'generate-fix', bar);
    expect(gfQualifier.state).toBe('measured');
    if (gfQualifier.state === 'measured') {
      expect(gfQualifier.supersededClauses.map((c) => c.path)).toEqual([
        'licenceStrings.nonInferiorityClause.generateFix.pass.text',
      ]);
      expect(gfQualifier.supersededClauses.some((c) => c.path.startsWith('licenceStrings.falsePassGate'))).toBe(
        false,
      );
      expect(gfQualifier.supersededClauses.some((c) => c.path.startsWith('licenceStrings.overallVerdict'))).toBe(
        false,
      );
    }

    const avQualifier = buildLicenceQualifier({ state: 'measured', value: 0.42 }, 'analyse-visual', bar);
    expect(avQualifier.state).toBe('measured');
    if (avQualifier.state === 'measured') {
      expect(avQualifier.supersededClauses.map((c) => c.path)).toEqual([
        'licenceStrings.nonInferiorityClause.analyseVisualCorrect.pass.text',
      ]);
      expect(avQualifier.supersededClauses.some((c) => c.path.startsWith('licenceStrings.falsePassGate'))).toBe(
        false,
      );
      expect(avQualifier.supersededClauses.some((c) => c.path.startsWith('licenceStrings.overallVerdict'))).toBe(
        false,
      );
    }
  });
});

describe('buildLicenceQualifier — not-yet-measured (Task 2)', () => {
  it('returns the not-measured shape, asserting the bar file clauses stand as written, for BOTH capabilities', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');

    for (const capability of ['generate-fix', 'analyse-visual'] as const) {
      const qualifier = buildLicenceQualifier({ state: 'not-yet-measured' }, capability, bar);
      expect(qualifier.state).toBe('not-yet-measured');
      if (qualifier.state === 'not-yet-measured') {
        expect(qualifier.note.length).toBeGreaterThan(0);
      }
      // The not-measured shape carries no superseded-clause fields at all.
      expect(Object.keys(qualifier).sort()).toEqual(['state', 'note'].sort());
    }
  });
});

describe('buildLicenceQualifier — measured (Task 2)', () => {
  it('names the observed value, the ceiling (read from the loaded bar, both capabilities happen to share 0.25), and the superseded clauses', () => {
    const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');

    for (const capability of ['generate-fix', 'analyse-visual'] as const) {
      const qualifier = buildLicenceQualifier({ state: 'measured', value: 0.42 }, capability, bar);
      expect(qualifier.state).toBe('measured');
      if (qualifier.state === 'measured') {
        expect(qualifier.observedRunToRunInstability).toBe(0.42);
        expect(qualifier.assumedCeiling).toBe(bar.varianceAssumption[capability].assumedValue);
        expect(qualifier.assumedCeiling).toBe(0.25);
        expect(qualifier.supersededClauses.length).toBeGreaterThan(0);
        expect(qualifier.note).toContain('SUPERSEDED');
        expect(qualifier.note).toContain('0.42');
      }
    }
  });
});

describe('buildLicenceQualifier — zero-clause throw (Task 2, "a search that finds nothing and a search that cannot match print the same zero")', () => {
  it('throws LicenceQualifierNoSupersededClausesFoundError when the walk over licenceStrings collects zero clauses', () => {
    // A scratch, uncommitted bar-like object whose licenceStrings carries
    // NONE of the unmeasured-instability fragment -- the shape buildLicence-
    // Qualifier reads (licenceStrings + varianceAssumption[capability]) only.
    const scratchBar = {
      licenceStrings: {
        falsePassGate: { pass: { additionalCaveatRequiredOnEveryPass: 'nothing relevant here' } },
        nonInferiorityClause: {
          generateFix: { pass: { text: 'also nothing relevant' } },
          analyseVisualCorrect: { pass: { text: 'still nothing relevant' } },
        },
      },
      varianceAssumption: {
        'generate-fix': { assumedValue: 0.25 },
        'analyse-visual': { assumedValue: 0.25 },
      },
    } as unknown as LoadedDecisionBars;

    expect(() => buildLicenceQualifier({ state: 'measured', value: 0.9 }, 'generate-fix', scratchBar)).toThrow(
      LicenceQualifierNoSupersededClausesFoundError,
    );
  });

  it('does NOT throw when instability is not-yet-measured, even over the same fragment-free scratch bar -- the walk only runs in the measured branch', () => {
    const scratchBar = {
      licenceStrings: { falsePassGate: { pass: { additionalCaveatRequiredOnEveryPass: 'nothing relevant' } } },
      varianceAssumption: { 'generate-fix': { assumedValue: 0.25 }, 'analyse-visual': { assumedValue: 0.25 } },
    } as unknown as LoadedDecisionBars;

    expect(() =>
      buildLicenceQualifier({ state: 'not-yet-measured' }, 'generate-fix', scratchBar),
    ).not.toThrow();
  });
});

describe('buildLicenceQualifier — the walk over non-object, non-string leaves and array-valued clauses (Task 2 defensive coverage)', () => {
  it('descends into an array-valued clause, finding the fragment inside one element', () => {
    // Scratch clause relocated under licenceStrings.nonInferiorityClause.generateFix
    // (AMD-1): the walk is now scoped to the verdict capability's own
    // non-inferiority subtree, so a clause anywhere else is invisible to it.
    const scratchBar = {
      licenceStrings: {
        nonInferiorityClause: {
          generateFix: {
            arrayHolder: [
              { text: 'nothing relevant' },
              { text: UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT + ', found inside an array element' },
            ],
          },
        },
      },
      varianceAssumption: { 'generate-fix': { assumedValue: 0.25 }, 'analyse-visual': { assumedValue: 0.25 } },
    } as unknown as LoadedDecisionBars;

    const qualifier = buildLicenceQualifier({ state: 'measured', value: 0.9 }, 'generate-fix', scratchBar);
    expect(qualifier.state).toBe('measured');
    if (qualifier.state === 'measured') {
      expect(qualifier.supersededClauses).toHaveLength(1);
      expect(qualifier.supersededClauses[0]!.path).toBe(
        'licenceStrings.nonInferiorityClause.generateFix.arrayHolder[1].text',
      );
    }
  });

  it('a number or boolean leaf is neither a string nor an object -- the walk skips it without throwing, and finds the fragment beside it', () => {
    const scratchBar = {
      licenceStrings: {
        nonInferiorityClause: {
          generateFix: {
            someNumericField: 42,
            someBooleanField: true,
            someNullField: null,
            actualClause: { text: UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT },
          },
        },
      },
      varianceAssumption: { 'generate-fix': { assumedValue: 0.25 }, 'analyse-visual': { assumedValue: 0.25 } },
    } as unknown as LoadedDecisionBars;

    const qualifier = buildLicenceQualifier({ state: 'measured', value: 0.9 }, 'generate-fix', scratchBar);
    expect(qualifier.state).toBe('measured');
    if (qualifier.state === 'measured') {
      expect(qualifier.supersededClauses).toHaveLength(1);
      expect(qualifier.supersededClauses[0]!.path).toBe(
        'licenceStrings.nonInferiorityClause.generateFix.actualClause.text',
      );
    }
  });
});
