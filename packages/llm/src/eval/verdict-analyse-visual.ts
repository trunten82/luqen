/**
 * `verdict-analyse-visual.ts` — the `analyse-visual` verdict comparator
 * (85-03, BARS-02/BARS-03, D-85-1, D-85-4).
 *
 * Composes TWO INDEPENDENT mechanisms, kept as two separate named fields with
 * two separate licences (D-85-1), NEVER merged into a fused number:
 *
 *   - `falsePassGate` — a DETERMINISTIC screening gate (D-85-4). A pure count
 *     comparison on the `falsePass` AGGREGATE counter: candidate.falsePass
 *     strictly greater than baseline.falsePass FAILS. No test, no p-value,
 *     no tolerance, no rate. This module never reads a per-item ground-truth
 *     field to compute it — a report carries none — and the opportunity
 *     denominator (7) comes from the BAR FILE, pinned there specifically
 *     because it cannot be derived from a report (an item's `expectedVerdict`
 *     is reference-set data, not report data).
 *   - `nonInferiorityClause` — the SAME statistical decision rule 85-02
 *     established for `generate-fix` (`computeNonInferiorityClause`,
 *     `verdict.ts`), reused wholesale rather than re-derived, applied to the
 *     `correct` counter at analyse-visual's own n (13) and margin (3 items,
 *     A-3).
 *
 * `overallVerdict` is the SINGLE derived summary word BARS-02 requires (A-5):
 * labelled as derived in the artifact itself, carrying its own licence, and
 * NEVER the only field a reader sees — both clause fields above always sit
 * beside it. Nothing in this module produces a combined score, a combined
 * rate, or a field that answers both clauses' questions at once — a
 * candidate that is non-inferior on the clause while clearing one more real
 * violation is visibly FAIL on the gate and visibly not-worse on the clause,
 * at the same time, in the same object (see the `falsePassGateFails`
 * synthetic candidate in the committed fixture, which is exactly this case).
 *
 * Precedence (bar file `verdictPrecedence.order`):
 *   1. The non-inferiority clause FAILS -> overall FAIL, regardless of power.
 *   2. The false-PASS screening gate FAILS -> overall FAIL, regardless of
 *      everything else — even a clause that is itself PASS.
 *   3. Otherwise, an insufficient power assessment on the clause yields
 *      UNDERPOWERED.
 *   4. PASS requires EVERY clause clear AND sufficient power.
 */
import type { AnalyseVisualReport } from './report.js';
import type { RunFunction } from './run-manifest.js';
import type { AnalyseVisualAggregate } from './aggregate.js';
import { assertBarAppliesTo, type LoadedDecisionBars } from './decision-bars.js';
import {
  assertAnalyseVisualAggregateMatchesRecount,
  assertHoldsInvariantFields,
  assertIdenticalItemIdSets,
  assertNoFailedItems,
  treatmentFieldsThatDiffered,
} from './verdict-comparability.js';
import {
  computeNonInferiorityClause,
  pairItemsByGoodness,
  scoresByItemId,
  InvalidVerdictJsonError,
  VerdictPassPowerContradictionError,
  assertLicenceQualifierMatchesInstabilityState,
} from './verdict.js';
import { buildLicenceQualifier } from './licence-qualifier.js';
import type {
  GatingAxisReport,
  LicenceQualifier,
  NonGatingAxisDelta,
  PowerAssessment,
  RunToRunInstability,
  SufficientPower,
  TreatmentFieldsDiffered,
  VerdictOutcome,
} from './verdict-types.js';

/**
 * The five `analyse-visual` axes reported as context, never gating (mirrors
 * D-85-2's `generate-fix` treatment). `correct` and `falsePass` are the two
 * GATING counters and are deliberately excluded from this list — they drive
 * `nonInferiorityClause`/`falsePassGate` above, never a context delta.
 */
const NON_GATING_COUNTER_NAMES = [
  'falseIssue',
  'uncertain',
  'altClassificationMismatchCount',
  'suggestedAltFilenameShapedCount',
  'suggestedAltEmptyDespiteInformationalCount',
] as const satisfies readonly (keyof AnalyseVisualAggregate)[];

// ---------------------------------------------------------------------------
// The false-PASS screening gate (D-85-1, D-85-4)
// ---------------------------------------------------------------------------

/**
 * The false-PASS screening gate's own result — a SEPARATE named field with
 * its own licence, never combined with `NonInferiorityClauseResult` below.
 */
export interface FalsePassGateResult {
  readonly outcome: 'PASS' | 'FAIL';
  readonly counterName: 'falsePass';
  readonly baselineFalsePassCount: number;
  readonly candidateFalsePassCount: number;
  /** From the BAR FILE, never derived from a report — a report carries no per-item ground truth (D-85-4). */
  readonly opportunityDenominator: number;
  readonly licence: string;
}

// ---------------------------------------------------------------------------
// The non-inferiority clause on `correct` (A-3)
// ---------------------------------------------------------------------------

/**
 * The statistical clause's own result — a SEPARATE named field with its own
 * licence, never combined with `FalsePassGateResult` above.
 */
export interface NonInferiorityClauseResult {
  readonly outcome: VerdictOutcome;
  readonly gatingAxis: GatingAxisReport;
  readonly power: PowerAssessment;
  readonly licence: string;
}

// ---------------------------------------------------------------------------
// The derived summary (A-5) — exists because BARS-02 demands ONE outcome,
// labelled as derived, never rendered without both fields above beside it.
// ---------------------------------------------------------------------------

export interface OverallVerdictSummary {
  readonly outcome: VerdictOutcome;
  /**
   * From the bar file's `licenceStrings.overallVerdict.note` — states, in
   * the artifact itself, that this word is DERIVED from the two clause
   * fields above and is not a stronger claim than either of them.
   */
  readonly derivedNote: string;
  readonly licence: string;
}

interface AnalyseVisualVerdictCommon {
  readonly capability: 'analyse-visual';
  readonly baselineRunFunction: RunFunction;
  readonly candidateRunFunction: RunFunction;
  readonly falsePassGate: FalsePassGateResult;
  readonly nonGatingAxisDeltas: readonly NonGatingAxisDelta[];
  readonly treatmentFieldsDiffered: TreatmentFieldsDiffered;
  readonly decisionBarsVersion: string;
  readonly decisionBarsDigestSha256: string;
  /** REQUIRED (Phase 86 Task 2, T-86-07) — the identical requirement `generate-fix` carries, see `LicenceQualifier`'s doc comment (verdict-types.ts). */
  readonly licenceQualifier: LicenceQualifier;
}

/**
 * The non-inferiority clause, narrowed to the SUFFICIENT power shape — the
 * only clause shape an overall PASS may carry (D-85-6).
 */
export interface NonInferiorityClausePassResult extends NonInferiorityClauseResult {
  readonly power: SufficientPower;
}

/**
 * D-85-6 / BARS-03, ENFORCED STRUCTURALLY FOR THIS CAPABILITY TOO.
 *
 * `generate-fix` already made PASS unconstructible with a failed power
 * assessment (`GenerateFixPassVerdict` narrows `power` to `SufficientPower`).
 * `analyse-visual` is a SECOND PATH through the same requirement, and it was
 * shipped as a flat interface whose `overallVerdict.outcome` and
 * `nonInferiorityClause.power.sufficient` were independent fields with no
 * type-level link — so `{ outcome: 'PASS', power: { sufficient: false } }`
 * COMPILED CLEANLY. Found by phase verification, which tried to construct one
 * for both capabilities rather than for the one that was known to be guarded.
 *
 * The live path never produced it — `compareAnalyseVisual` composes the
 * outcome correctly — so this was a latent type-system gap, not an observed
 * defect. That is exactly why it is worth closing: the requirement says the
 * block is a property of the TYPE ("not 'should not' — cannot"), and a rule
 * that holds only because the one current call site happens to be correct is
 * a convention, not a structure.
 *
 * The general shape, which this repo has hit before: WHEN YOU ADD A SECOND
 * PATH TO AN EXISTING OPERATION, RE-PROVE THE INVARIANTS THE FIRST PATH
 * ENFORCED. Both paths were written from the same requirement; only one
 * carried the guarantee.
 *
 * To BREAK IT: construct an `AnalyseVisualVerdict` with
 * `overallVerdict.outcome: 'PASS'` and a `nonInferiorityClause.power` whose
 * `sufficient` is `false`, then run `npx tsc --noEmit`. It must fail HERE, at
 * the assignment, not somewhere earlier.
 */
export interface AnalyseVisualPassVerdict extends AnalyseVisualVerdictCommon {
  readonly nonInferiorityClause: NonInferiorityClausePassResult;
  readonly overallVerdict: OverallVerdictSummary & { readonly outcome: 'PASS' };
}

export interface AnalyseVisualFailVerdict extends AnalyseVisualVerdictCommon {
  /** Either shape — an observed regression does not need power to be believed. */
  readonly nonInferiorityClause: NonInferiorityClauseResult;
  readonly overallVerdict: OverallVerdictSummary & { readonly outcome: 'FAIL' };
}

export interface AnalyseVisualUnderpoweredVerdict extends AnalyseVisualVerdictCommon {
  readonly nonInferiorityClause: NonInferiorityClauseResult;
  readonly overallVerdict: OverallVerdictSummary & { readonly outcome: 'UNDERPOWERED' };
}

export type AnalyseVisualVerdict =
  | AnalyseVisualPassVerdict
  | AnalyseVisualFailVerdict
  | AnalyseVisualUnderpoweredVerdict;

/**
 * Computes the `analyse-visual` verdict for a baseline/candidate report pair
 * against a loaded decision bar. Pure function — no db, no adapter, no
 * clock, no network, matching `compareGenerateFix`'s discipline (verdict.ts).
 *
 * `runToRunInstability` is a REQUIRED fourth parameter (86-01, D-85-5) —
 * the identical requirement `compareGenerateFix` now carries, checked here
 * independently rather than assumed inherited: no default value, so the
 * caller must say what the instability is (`{ state: 'not-yet-measured' }`
 * or `{ state: 'measured', value }`, see instability.ts) instead of the
 * comparator supplying a silent default.
 */
export function compareAnalyseVisual(
  bar: LoadedDecisionBars,
  baseline: AnalyseVisualReport,
  candidate: AnalyseVisualReport,
  runToRunInstability: RunToRunInstability,
): AnalyseVisualVerdict {
  assertBarAppliesTo(bar, baseline.runFunction);
  assertBarAppliesTo(bar, candidate.runFunction);
  assertHoldsInvariantFields(baseline.runFunction, candidate.runFunction);
  assertNoFailedItems(baseline.items, candidate.items);
  assertIdenticalItemIdSets(baseline.items, candidate.items);
  // T-85-06 — both decision-bearing counters, for BOTH sides. Without this a
  // hand-edited aggregate.falsePass flowed straight into the verdict (live gap,
  // found by phase verification).
  assertAnalyseVisualAggregateMatchesRecount('baseline', baseline.items, baseline.aggregate);
  assertAnalyseVisualAggregateMatchesRecount('candidate', candidate.items, candidate.aggregate);

  const capabilityBar = bar.capabilityBars['analyse-visual'];
  const clauseN = capabilityBar.nonInferiorityClause.n;
  const marginItems = capabilityBar.nonInferiorityClause.marginItems;
  const clauseCounterName = capabilityBar.nonInferiorityClause.counterName;
  const assumedDiscordantPairRate = bar.varianceAssumption['analyse-visual'].assumedValue;
  // The opportunity denominator (7) is PINNED in the bar file, never derived
  // here — a report does not carry per-item ground truth (D-85-4).
  const opportunityDenominator = capabilityBar.falsePassScreeningGate.opportunityDenominator.value;

  const baselineScores = scoresByItemId(baseline.items);
  const candidateScores = scoresByItemId(candidate.items);

  // Per-item pairing on the CLAUSE's axis (`correct`) — the false-PASS gate
  // below reads the aggregate directly and never touches this pairing.
  const baselineGoodByItemId = new Map<string, boolean>();
  for (const [itemId, score] of baselineScores) {
    baselineGoodByItemId.set(itemId, score.verdictOutcome === 'correct');
  }
  const candidateGoodByItemId = new Map<string, boolean>();
  for (const [itemId, score] of candidateScores) {
    candidateGoodByItemId.set(itemId, score.verdictOutcome === 'correct');
  }

  const { baselineBetterCount, candidateBetterCount } = pairItemsByGoodness(
    baselineGoodByItemId,
    candidateGoodByItemId,
  );

  const clauseComputation = computeNonInferiorityClause(
    clauseCounterName,
    baselineBetterCount,
    candidateBetterCount,
    clauseN,
    marginItems,
    assumedDiscordantPairRate,
    runToRunInstability,
  );

  const clauseLicences = bar.licenceStrings.nonInferiorityClause.analyseVisualCorrect;
  // Same precedence arithmetic as compareGenerateFix's clause (D-85-6):
  // a raw net delta beyond the margin FAILS regardless of power; otherwise
  // insufficient power is UNDERPOWERED; otherwise PASS.
  let clauseOutcome: VerdictOutcome;
  let clauseLicenceText: string;
  if (clauseComputation.gatingAxis.observedItemDelta > marginItems) {
    clauseOutcome = 'FAIL';
    clauseLicenceText = clauseLicences.fail.text;
  } else if (!clauseComputation.power.sufficient) {
    clauseOutcome = 'UNDERPOWERED';
    clauseLicenceText = clauseLicences.underpowered.text;
  } else {
    clauseOutcome = 'PASS';
    clauseLicenceText = clauseLicences.pass.text;
  }

  const nonInferiorityClause: NonInferiorityClauseResult = {
    outcome: clauseOutcome,
    gatingAxis: clauseComputation.gatingAxis,
    power: clauseComputation.power,
    licence: clauseLicenceText,
  };

  // The false-PASS screening gate — a PURE COUNT COMPARISON on the AGGREGATE
  // counters, never per-item pairing, never a rate, never a test (D-85-4).
  // No tolerance constant, no epsilon, anywhere near this comparison.
  const baselineFalsePassCount = baseline.aggregate.falsePass;
  const candidateFalsePassCount = candidate.aggregate.falsePass;
  const gateOutcome: 'PASS' | 'FAIL' = candidateFalsePassCount > baselineFalsePassCount ? 'FAIL' : 'PASS';
  const gateLicences = bar.licenceStrings.falsePassGate;
  const falsePassGate: FalsePassGateResult = {
    outcome: gateOutcome,
    counterName: 'falsePass',
    baselineFalsePassCount,
    candidateFalsePassCount,
    opportunityDenominator,
    // On PASS: the D-85-4 sentence, reproduced VERBATIM (do not edit), plus
    // the run-to-run-instability caveat the bar file requires alongside it
    // (licenceStrings.falsePassGate.pass.additionalCaveatRequiredOnEveryPass).
    // On FAIL: the bar file's single fail.text field.
    licence:
      gateOutcome === 'FAIL'
        ? gateLicences.fail.text
        : `${gateLicences.pass.verbatimFromD854} ${gateLicences.pass.additionalCaveatRequiredOnEveryPass}`,
  };

  // Verdict precedence (D-85-6, bar file `verdictPrecedence.order`):
  //   rank 1: the non-inferiority clause FAILS -> overall FAIL, regardless of power.
  //   rank 2: the false-PASS screening gate FAILS -> overall FAIL, regardless
  //           of everything else — even a clause that is itself PASS. This is
  //           what makes "non-inferior on the clause, one more real violation
  //           cleared" visibly FAIL (must_haves.truths, 85-03-PLAN.md).
  //   rank 3: otherwise, an insufficient power assessment on the clause
  //           yields UNDERPOWERED.
  //   rank 4: PASS requires EVERY clause clear AND sufficient power.
  const overallOutcome: VerdictOutcome =
    nonInferiorityClause.outcome === 'FAIL' || falsePassGate.outcome === 'FAIL'
      ? 'FAIL'
      : nonInferiorityClause.outcome === 'UNDERPOWERED'
        ? 'UNDERPOWERED'
        : 'PASS';

  const overallLicences = bar.licenceStrings.overallVerdict;
  const overallVerdict: OverallVerdictSummary = {
    outcome: overallOutcome,
    derivedNote: overallLicences.note,
    licence:
      overallOutcome === 'FAIL'
        ? overallLicences.fail.text
        : overallOutcome === 'UNDERPOWERED'
          ? overallLicences.underpowered.text
          : overallLicences.pass.text,
  };

  const nonGatingAxisDeltas = NON_GATING_COUNTER_NAMES.map((counterName) => ({
    counterName,
    baselineMinusCandidate: baseline.aggregate[counterName] - candidate.aggregate[counterName],
  }));

  const treatmentFieldsDiffered = treatmentFieldsThatDiffered(baseline.runFunction, candidate.runFunction);

  const licenceQualifier: LicenceQualifier = buildLicenceQualifier(runToRunInstability, 'analyse-visual', bar);

  const common = {
    capability: 'analyse-visual',
    baselineRunFunction: baseline.runFunction,
    candidateRunFunction: candidate.runFunction,
    falsePassGate,
    nonGatingAxisDeltas,
    treatmentFieldsDiffered,
    decisionBarsVersion: bar.barsVersion,
    decisionBarsDigestSha256: bar.digestSha256,
    licenceQualifier,
  } as const;

  // Narrow into the discriminated union (D-85-6). The PASS branch is the point:
  // it can only be constructed once `nonInferiorityClause.power` is proven
  // `sufficient: true`, so an overall PASS carrying a failed power assessment is
  // a COMPILE error rather than a convention this one function happens to keep.
  if (overallOutcome === 'PASS') {
    const power = nonInferiorityClause.power;
    if (!power.sufficient) {
      // Unreachable via the composition above; a runtime backstop so a future
      // edit to the outcome logic fails loudly rather than reaching for a cast.
      throw new Error(
        'Refusing to emit an analyse-visual PASS with an insufficient power assessment (D-85-6/BARS-03).',
      );
    }
    return {
      ...common,
      nonInferiorityClause: { ...nonInferiorityClause, power },
      overallVerdict: { ...overallVerdict, outcome: 'PASS' },
    };
  }
  if (overallOutcome === 'FAIL') {
    return { ...common, nonInferiorityClause, overallVerdict: { ...overallVerdict, outcome: 'FAIL' } };
  }
  return { ...common, nonInferiorityClause, overallVerdict: { ...overallVerdict, outcome: 'UNDERPOWERED' } };
}

/**
 * Serialises a verdict to pretty-printed JSON — the shape a maintainer
 * commits or diffs, matching `verdict.ts`'s `serialiseVerdict` convention.
 */
export function serialiseAnalyseVisualVerdict(verdict: AnalyseVisualVerdict): string {
  return JSON.stringify(verdict, null, 2);
}

/**
 * The ONLY supported path for reading an `analyse-visual` verdict back from
 * JSON — mirrors `verdict.ts`'s `parseVerdict` exactly: the same shape check
 * on the top-level value, and the same runtime re-assertion of the
 * invariant the discriminated union enforces at compile time (D-85-6): an
 * `overallVerdict.outcome` of `'PASS'` demands
 * `nonInferiorityClause.power.sufficient === true`.
 *
 * This is the second path this repository's own standing lesson warns
 * about: `generate-fix` has carried this guarantee since 85-02;
 * `analyse-visual` never had a parse counterpart at all — only
 * `serialiseAnalyseVisualVerdict` existed. Phase 86 makes the instability
 * arrive from outside the comparator and 86-02 makes it decide outcomes; the
 * moment a measured instability can force UNDERPOWERED, a verdict artifact
 * read back off disk becomes a thing a person can hand-edit into a PASS.
 * `generate-fix` was guarded at that boundary and `analyse-visual` was not
 * — closed here, before the artifact it protects starts to exist.
 *
 * Reuses `InvalidVerdictJsonError` and `VerdictPassPowerContradictionError`
 * from `verdict.ts` by importing them — the SAME shape-level and
 * contradiction errors both capabilities' parsers throw, never a second,
 * parallel error class for the identical failure.
 */
export function parseAnalyseVisualVerdict(json: string): AnalyseVisualVerdict {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidVerdictJsonError('top-level value is not an object');
  }
  const record = parsed as Record<string, unknown>;

  const overallVerdictRaw = record['overallVerdict'];
  const outcome =
    overallVerdictRaw !== null && typeof overallVerdictRaw === 'object'
      ? (overallVerdictRaw as Record<string, unknown>)['outcome']
      : undefined;

  const nonInferiorityClauseRaw = record['nonInferiorityClause'];
  const powerRaw =
    nonInferiorityClauseRaw !== null && typeof nonInferiorityClauseRaw === 'object'
      ? (nonInferiorityClauseRaw as Record<string, unknown>)['power']
      : undefined;
  const sufficient =
    powerRaw !== null && typeof powerRaw === 'object' && (powerRaw as Record<string, unknown>)['sufficient'];

  if (outcome === 'PASS' && sufficient !== true) {
    throw new VerdictPassPowerContradictionError();
  }
  // Phase 86 Task 2 (T-86-07): the same licence-qualifier/instability-state
  // cross-check generate-fix's parseVerdict now carries -- reused via the
  // shared helper (verdict.ts), never re-derived. analyse-visual nests
  // `power` one level deeper (inside `nonInferiorityClause`), which is
  // exactly why this is a helper taking the already-extracted `power` value
  // rather than each parser hand-rolling its own path.
  assertLicenceQualifierMatchesInstabilityState(record, powerRaw);
  return parsed as AnalyseVisualVerdict;
}
