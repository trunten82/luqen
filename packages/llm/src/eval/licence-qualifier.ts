/**
 * `licence-qualifier.ts` — the SOLE constructor of `LicenceQualifier`
 * (Phase 86 Task 2, T-86-07).
 *
 * THE PROBLEM THIS MODULE CLOSES: every PASS licence Phase 85 pre-registered
 * asserts, verbatim, that run-to-run instability was NOT measured for the
 * comparison. That sentence was true when written. The moment 86-01/86-02
 * measure the quantity, a verdict emitting that clause unchanged states
 * something false — and in the reassuring direction for "did anyone ever run
 * the baseline?", which is the direction nobody re-checks. The bar file
 * cannot be edited to fix this (it is pre-registered and digest-pinned — see
 * `<working_rules>` in 86-02-PLAN.md), so the verdict carries the correction
 * instead.
 *
 * `buildLicenceQualifier` walks the loaded bar's `licenceStrings` object and
 * collects every string containing `UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT`
 * — ENUMERATED from the bar's own data, never a hand-written list of three,
 * so a fourth such clause added to the bar file tomorrow would be found
 * automatically. Throws if the walk finds ZERO clauses in the measured case
 * (a search that finds nothing and a search that cannot match print the
 * same zero).
 */
import type { LoadedDecisionBars } from './decision-bars.js';
import type { LicenceQualifier, RunToRunInstability, SupersededLicenceClause } from './verdict-types.js';

/**
 * The verbatim clause fragment the bar file uses, in all three of its PASS
 * licence surfaces, to declare run-to-run instability unmeasured. Sourced by
 * reading `tests/eval/bars/decision-bars.v1.json` directly (never from
 * memory): the fragment is present, character-for-character, in
 * `licenceStrings.falsePassGate.pass.additionalCaveatRequiredOnEveryPass`,
 * `licenceStrings.nonInferiorityClause.generateFix.pass.text`, and
 * `licenceStrings.nonInferiorityClause.analyseVisualCorrect.pass.text` — the
 * committed pin test (`licence-qualifier.test.ts`) asserts exactly these
 * three paths and exactly this count against the loaded bar.
 *
 * The fragment deliberately stops short of trailing punctuation: the three
 * surfaces punctuate it differently (". A PASS" vs "; a PASS"), so the
 * longest substring common to all three ends right after "comparison".
 */
export const UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT = 'Run-to-run instability was not measured for this comparison';

/** Thrown when `buildLicenceQualifier` is asked to build the MEASURED shape but the walk over the loaded bar's `licenceStrings` finds zero clauses containing {@link UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT}. A zero-clause measured qualifier would supersede nothing while still claiming to supersede something -- refused rather than silently constructed. */
export class LicenceQualifierNoSupersededClausesFoundError extends Error {
  constructor(public readonly fragment: string) {
    super(
      `buildLicenceQualifier found ZERO licence clauses containing the fragment "${fragment}" in the loaded bar's licenceStrings -- refusing to construct a measured qualifier that supersedes nothing`,
    );
    this.name = 'LicenceQualifierNoSupersededClausesFoundError';
  }
}

/**
 * Recursively walks a JSON-shaped value collecting every string that
 * contains `fragment`, paired with its dotted path from `pathPrefix`. Used
 * ONLY over `bar.licenceStrings` (a plain, fully-typed, JSON-shaped object —
 * see `decision-bars.ts`'s `LicenceStringsSchema`), so no cycle handling is
 * needed.
 */
function collectClausesContainingFragment(
  value: unknown,
  fragment: string,
  pathPrefix: string,
): SupersededLicenceClause[] {
  if (typeof value === 'string') {
    return value.includes(fragment) ? [{ path: pathPrefix, clauseText: value }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectClausesContainingFragment(item, fragment, `${pathPrefix}[${index}]`),
    );
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      collectClausesContainingFragment(child, fragment, `${pathPrefix}.${key}`),
    );
  }
  return [];
}

/**
 * The SOLE constructor of `LicenceQualifier` (verdict-types.ts). Called once
 * each from `compareGenerateFix` / `compareAnalyseVisual`, from the
 * `runToRunInstability` value they already receive as a required parameter
 * (86-01) and the `capability` they already know, against the SAME loaded
 * bar they already have in hand.
 *
 * NOT-MEASURED: returns the not-measured shape, asserting as data that the
 * bar file's licence clauses stand as written -- no walk is performed.
 *
 * MEASURED: walks `bar.licenceStrings` for every clause containing
 * {@link UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT}, reads the ceiling from
 * `bar.varianceAssumption[capability].assumedValue` -- the SAME reused
 * number `assessPower` (verdict.ts) checks the measurement against, read
 * from the SAME loaded bar rather than re-derived -- and returns the
 * measured shape. THROWS `LicenceQualifierNoSupersededClausesFoundError` if
 * the walk collects zero clauses.
 */
export function buildLicenceQualifier(
  instability: RunToRunInstability,
  capability: 'generate-fix' | 'analyse-visual',
  bar: LoadedDecisionBars,
): LicenceQualifier {
  if (instability.state === 'not-yet-measured') {
    return {
      state: 'not-yet-measured',
      note:
        "Run-to-run instability has not been measured for this comparison; the bar file's licence clauses stand as written -- nothing is superseded.",
    };
  }

  const found = collectClausesContainingFragment(bar.licenceStrings, UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT, 'licenceStrings');
  if (found.length === 0) {
    throw new LicenceQualifierNoSupersededClausesFoundError(UNMEASURED_INSTABILITY_CLAUSE_FRAGMENT);
  }

  const assumedCeiling = bar.varianceAssumption[capability].assumedValue;
  const [first, ...rest] = found;
  const supersededClauses: readonly [SupersededLicenceClause, ...SupersededLicenceClause[]] = [first!, ...rest];

  return {
    state: 'measured',
    observedRunToRunInstability: instability.value,
    assumedCeiling,
    supersededClauses,
    note: `Run-to-run instability was measured at ${instability.value} (ceiling ${assumedCeiling}, reused from varianceAssumption.${capability} -- see RUN_TO_RUN_INSTABILITY_CEILING_NOTE); the following ${supersededClauses.length} bar-file clause(s), which assert the quantity was not measured, are SUPERSEDED for this verdict: ${supersededClauses.map((c) => c.path).join(', ')}.`,
  };
}
