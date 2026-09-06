/**
 * `verdict.ts` — the `generate-fix` non-inferiority comparator (85-02,
 * BARS-01/BARS-03), plus (85-03) the SHARED arithmetic 85-02 established:
 * item-pairing, power assessment, and the non-inferiority clause
 * computation. `verdict-analyse-visual.ts` imports these three exports
 * wholesale rather than re-deriving them — "one shape per phase, established
 * once for `generate-fix` and applied here" (85-03-PLAN.md Task 1). This
 * refactor does not change `compareGenerateFix`'s observable behaviour: the
 * arithmetic moved into named functions, the branching and numbers did not.
 *
 * `compareGenerateFix` is a PURE function of a loaded decision bar plus two
 * `HarnessReport`s: it takes no db, no adapter, no clock, no network. It
 * assembles the verdict end to end: refuses a bar/run mismatch (via the
 * existing `decision-bars.ts` guard), refuses runs that differ on a field
 * the experiment must hold constant (`verdict-comparability.ts` — NOT
 * `assertComparable`, see that module's doc comment), pairs the two reports'
 * scored items item-by-item on the gating axis, computes the exact one-sided
 * Clopper-Pearson bound on the baseline-better rate ALONE (A-1), and applies
 * the bar file's own recorded verdict precedence.
 *
 * EMITS NO BLENDED, FUSED OR WEIGHTED NUMBER ANYWHERE. The five non-gating
 * `generate-fix` axes are reported as raw baseline-minus-candidate deltas,
 * visible, never gating (D-85-2) — HARNESS-03 exists because fusing distinct
 * axes destroys the distinction that matters.
 */
import { assertBarAppliesTo, type LoadedDecisionBars } from './decision-bars.js';
import { isScoredItem, type GenerateFixReport, type ItemRecord } from './report.js';
import type { GenerateFixAggregate } from './aggregate.js';
import type { GenerateFixScoreRecord } from './score-generate-fix.js';
import {
  assertAggregateMatchesRecount,
  assertHoldsInvariantFields,
  assertIdenticalItemIdSets,
  assertNoFailedItems,
  treatmentFieldsThatDiffered,
} from './verdict-comparability.js';
import { computeDifferenceUpperBound, type DifferenceUpperBoundResult } from './power.js';
import type {
  GatingAxisReport,
  GenerateFixVerdict,
  PowerAssessment,
  PowerInsufficiencyReason,
  RunToRunInstability,
} from './verdict-types.js';
import { RUN_TO_RUN_INSTABILITY_CEILING_NOTE } from './verdict-types.js';

/** The five `generate-fix` axes reported as context, never gating (D-85-2, bar file `capabilityBars.generate-fix.nonGatingAxes`). */
const NON_GATING_COUNTER_NAMES = [
  'unchangedFromInputCount',
  'emptyFixCount',
  'missingMentionsCount',
  'effortMatchCount',
  'filenameShapedAltCount',
] as const satisfies readonly (keyof GenerateFixAggregate)[];

/**
 * Reads a capability's per-item scored records into an itemId -> score map.
 * Generic over the score-record shape so `generate-fix` and `analyse-visual`
 * share this ONE reading (85-03) rather than each writing their own.
 */
export function scoresByItemId<TScore>(items: readonly ItemRecord<TScore>[]): Map<string, TScore> {
  const map = new Map<string, TScore>();
  for (const item of items) {
    if (isScoredItem(item)) map.set(item.itemId, item.score);
  }
  return map;
}

export interface PairedItemCounts {
  readonly baselineBetterCount: number;
  readonly candidateBetterCount: number;
}

/**
 * Pairs two "is this item good" maps item-by-item on their shared item id,
 * counting how many items each side is better on. DELIBERATELY never derived
 * from an aggregate delta: a candidate that fixes k items and breaks k
 * others shows an aggregate delta of zero but a discordance of 2k, and those
 * are different facts about how much this instrument can see (85-02).
 * Capability-agnostic — `generate-fix` pairs on `exactMatch`,
 * `analyse-visual` pairs on `verdictOutcome === 'correct'` (85-03), both
 * calling this ONE function.
 */
export function pairItemsByGoodness(
  baselineGoodByItemId: ReadonlyMap<string, boolean>,
  candidateGoodByItemId: ReadonlyMap<string, boolean>,
): PairedItemCounts {
  let baselineBetterCount = 0;
  let candidateBetterCount = 0;
  for (const [itemId, baselineGood] of baselineGoodByItemId) {
    const candidateGood = candidateGoodByItemId.get(itemId);
    if (candidateGood === undefined) continue;
    if (baselineGood && !candidateGood) baselineBetterCount += 1;
    if (candidateGood && !baselineGood) candidateBetterCount += 1;
  }
  return { baselineBetterCount, candidateBetterCount };
}

/**
 * Assesses power for a non-inferiority clause (D-85-5, Phase 86 BASELINE-02):
 * THREE INDEPENDENT insufficiency reasons, all checked, any subset may appear
 * together — they are not mutually exclusive. Capability-agnostic: takes the
 * already-computed Clopper-Pearson bound result, never recomputes it.
 *
 * THE THIRD REASON — `run-to-run-instability-exceeds-ceiling` — checks the
 * measured run-to-run score instability (a DIFFERENT quantity from the
 * discordant-pair rate, D-85-5) against `assumedDiscordantPairRate` REUSED as
 * a ceiling. Why that number, and only in this direction: the pre-registered
 * `n` was sized under an assumption that budgets `assumedDiscordantPairRate`
 * total disagreement between the two runs being compared; if the
 * instrument's own noise floor already exceeds that entire budget, the
 * pre-registered `n` cannot detect the margin regardless of what the
 * discordance turns out to be. This check can only ever ADD a reason, never
 * remove one, so it can only make a verdict MORE conservative — a
 * correction that STRENGTHENS a bar needs no re-consent, one that WEAKENS it
 * does, and this sits on the safe side of that line, needing no new
 * pre-registered number of its own. REQUIRED WORDING (coordinator ruling,
 * 2026-09-06), reproduced verbatim on every rendering surface via
 * {@link RUN_TO_RUN_INSTABILITY_CEILING_NOTE}: this ceiling is a REUSE of a
 * differently-named quantity's number, adopted because it can only tighten —
 * NOT a pre-registered instability threshold. No separate instability
 * threshold was pre-registered, because Phase 85 correctly declined to
 * invent a number for a quantity nobody had measured, and inventing one now
 * — after this phase exists to produce the first measurement — would be
 * exactly the fitting the milestone forbids.
 *
 * The boundary is EXCLUSIVE, consistently with `discordance-exceeds-
 * assumption` above: a measured value equal to the ceiling is not an
 * exceedance.
 */
export function assessPower(
  observedDiscordantPairRate: number,
  assumedDiscordantPairRate: number,
  bound: DifferenceUpperBoundResult,
  runToRunInstability: RunToRunInstability,
): PowerAssessment {
  const reasons: PowerInsufficiencyReason[] = [];
  if (observedDiscordantPairRate > assumedDiscordantPairRate) {
    reasons.push({
      kind: 'discordance-exceeds-assumption',
      assumedDiscordantPairRate,
      observedDiscordantPairRate,
    });
  }
  if (!bound.certifies) {
    reasons.push({
      kind: 'bound-does-not-clear-margin',
      upperBound: bound.upperBound,
      marginProportion: bound.marginProportion,
    });
  }
  if (runToRunInstability.state === 'measured' && runToRunInstability.value > assumedDiscordantPairRate) {
    reasons.push({
      kind: 'run-to-run-instability-exceeds-ceiling',
      observedRunToRunInstability: runToRunInstability.value,
      assumedCeiling: assumedDiscordantPairRate,
    });
  }
  if (reasons.length > 0) {
    return {
      sufficient: false,
      reasons: [reasons[0]!, ...reasons.slice(1)],
      assumedDiscordantPairRate,
      observedDiscordantPairRate,
      runToRunInstability,
    };
  }
  return { sufficient: true, assumedDiscordantPairRate, observedDiscordantPairRate, runToRunInstability };
}

/**
 * Renders one `PowerInsufficiencyReason` as a human-readable line — the ONE
 * real consumer of `reason.kind` beyond a bare print (Phase 86 planning
 * caught, before this task was executed, that an exhaustiveness assertion
 * over the reason kinds would otherwise be INERT: nothing consumed
 * `reason.kind` beyond `printPowerAssessment` in `cli.ts` printing it alone,
 * so there was nothing for a `never`-typed default branch to force). This
 * function IS that consumer, and `cli.ts`'s `printPowerAssessment` calls it.
 *
 * The `switch` is EXHAUSTIVE over `PowerInsufficiencyReason['kind']` and the
 * `default` branch types the unreached value as `never` — a fourth reason
 * kind added to the union without a matching `case` here fails to compile,
 * not merely to run correctly. To BREAK IT (do this rather than trust it):
 * add a throwaway fourth member to `PowerInsufficiencyReason` in
 * verdict-types.ts, run `npx tsc --noEmit -p packages/llm/tsconfig.json`,
 * and confirm it fails HERE, at the `default` branch's `never` assignment —
 * not somewhere incidental. Then remove the throwaway member and confirm
 * `git status --short` is empty. Do not "simplify" this back to a bare
 * `console.log(reason.kind)` — that is the exact inert-guard shape
 * `run-manifest.ts` already carries a recorded warning against.
 */
export function describeInsufficiencyReason(reason: PowerInsufficiencyReason): string {
  switch (reason.kind) {
    case 'discordance-exceeds-assumption':
      return `discordance-exceeds-assumption: observed McNemar discordant-pair rate ${reason.observedDiscordantPairRate} exceeded the pre-registered assumption ${reason.assumedDiscordantPairRate}`;
    case 'bound-does-not-clear-margin':
      return `bound-does-not-clear-margin: the one-sided Clopper-Pearson upper bound ${reason.upperBound} did not clear the margin proportion ${reason.marginProportion}`;
    case 'run-to-run-instability-exceeds-ceiling':
      return `run-to-run-instability-exceeds-ceiling: observed run-to-run instability ${reason.observedRunToRunInstability} exceeded the ceiling ${reason.assumedCeiling}. ${RUN_TO_RUN_INSTABILITY_CEILING_NOTE}`;
    default: {
      const unreachable: never = reason;
      throw new Error(`Unhandled PowerInsufficiencyReason kind: ${JSON.stringify(unreachable)}`);
    }
  }
}

export interface NonInferiorityClauseComputation {
  readonly gatingAxis: GatingAxisReport;
  readonly power: PowerAssessment;
}

/**
 * The one-sided Clopper-Pearson non-inferiority clause (A-1), computed once
 * and shared by every capability's clause: `generate-fix`'s single bar and
 * `analyse-visual`'s `nonInferiorityClause` (85-03) both call this SAME
 * function with their own counter name / counts / n / margin — never a
 * second, re-derived arithmetic path (85-03-PLAN.md: "the same decision rule
 * as the generate-fix gating axis"). Returns the gating-axis report and power
 * assessment only; FAIL/UNDERPOWERED/PASS composition (verdict precedence)
 * is a capability-specific concern left to each caller, since `generate-fix`
 * has no false-PASS gate to compose against and `analyse-visual` does.
 */
export function computeNonInferiorityClause(
  counterName: string,
  baselineBetterCount: number,
  candidateBetterCount: number,
  n: number,
  marginItems: number,
  assumedDiscordantPairRate: number,
  runToRunInstability: RunToRunInstability,
): NonInferiorityClauseComputation {
  const discordantPairCount = baselineBetterCount + candidateBetterCount;
  const observedItemDelta = baselineBetterCount - candidateBetterCount;
  const observedDiscordantPairRate = discordantPairCount / n;

  const bound = computeDifferenceUpperBound(baselineBetterCount, n, marginItems);
  const power = assessPower(observedDiscordantPairRate, assumedDiscordantPairRate, bound, runToRunInstability);

  const gatingAxis: GatingAxisReport = {
    counterName,
    baselineBetterCount,
    candidateBetterCount,
    discordantPairCount,
    observedItemDelta,
    marginItems,
    upperBound: bound.upperBound,
    marginProportion: bound.marginProportion,
    certifies: bound.certifies,
  };

  return { gatingAxis, power };
}

/**
 * Computes the `generate-fix` non-inferiority verdict for a baseline/
 * candidate report pair against a loaded decision bar.
 *
 * Item pairing is deliberately item-by-item (never derived from the two
 * aggregates' delta): a candidate that fixes k items and breaks k others
 * shows an aggregate delta of zero but a discordance of 2k, and those are
 * different facts about how much this instrument can see.
 *
 * `runToRunInstability` is a REQUIRED fourth parameter (86-01, D-85-5) —
 * deliberately no default value. A default is exactly the mechanism by
 * which a required field decays into "optional but always populated in
 * practice" (85-RESEARCH.md Pitfall 2). The caller must say what the
 * instability is — `{ state: 'not-yet-measured' }` if it has not been
 * measured, `{ state: 'measured', value }` (see instability.ts) once it
 * has — the comparator can no longer supply a silent default on its own.
 */
export function compareGenerateFix(
  bar: LoadedDecisionBars,
  baseline: GenerateFixReport,
  candidate: GenerateFixReport,
  runToRunInstability: RunToRunInstability,
): GenerateFixVerdict {
  assertBarAppliesTo(bar, baseline.runFunction);
  assertBarAppliesTo(bar, candidate.runFunction);
  assertHoldsInvariantFields(baseline.runFunction, candidate.runFunction);
  assertNoFailedItems(baseline.items, candidate.items);
  assertIdenticalItemIdSets(baseline.items, candidate.items);
  assertAggregateMatchesRecount('baseline', baseline.items, baseline.aggregate.exactMatchCount);
  assertAggregateMatchesRecount('candidate', candidate.items, candidate.aggregate.exactMatchCount);

  const capabilityBar = bar.capabilityBars['generate-fix'];
  const n = capabilityBar.n;
  const marginItems = capabilityBar.nonInferiorityMargin.marginItems;
  const gatingCounterName = capabilityBar.gatingAxis.counterName;
  const assumedDiscordantPairRate = bar.varianceAssumption['generate-fix'].assumedValue;

  const baselineScores = scoresByItemId(baseline.items);
  const candidateScores = scoresByItemId(candidate.items);

  // Per-item pairing on the gating axis (exactMatch). The refusals above
  // already guarantee identical item-id sets and no failed items, so every
  // baseline id has a candidate counterpart here by construction.
  const baselineGoodByItemId = new Map<string, boolean>();
  for (const [itemId, score] of baselineScores) baselineGoodByItemId.set(itemId, score.exactMatch);
  const candidateGoodByItemId = new Map<string, boolean>();
  for (const [itemId, score] of candidateScores) candidateGoodByItemId.set(itemId, score.exactMatch);

  const { baselineBetterCount, candidateBetterCount } = pairItemsByGoodness(
    baselineGoodByItemId,
    candidateGoodByItemId,
  );

  const clause = computeNonInferiorityClause(
    gatingCounterName,
    baselineBetterCount,
    candidateBetterCount,
    n,
    marginItems,
    assumedDiscordantPairRate,
    runToRunInstability,
  );

  const nonGatingAxisDeltas = NON_GATING_COUNTER_NAMES.map((counterName) => ({
    counterName,
    baselineMinusCandidate: baseline.aggregate[counterName] - candidate.aggregate[counterName],
  }));

  const treatmentFieldsDiffered = treatmentFieldsThatDiffered(baseline.runFunction, candidate.runFunction);

  const common = {
    capability: 'generate-fix' as const,
    baselineRunFunction: baseline.runFunction,
    candidateRunFunction: candidate.runFunction,
    gatingAxis: clause.gatingAxis,
    nonGatingAxisDeltas,
    treatmentFieldsDiffered,
    decisionBarsVersion: bar.barsVersion,
    decisionBarsDigestSha256: bar.digestSha256,
  };

  const licences = bar.licenceStrings.nonInferiorityClause.generateFix;

  // Verdict precedence (D-85-6, bar file `verdictPrecedence.order`):
  //   1. An observed regression beyond the tolerated margin FAILS, regardless
  //      of power. This is the RAW observed net delta (baselineBetterCount -
  //      candidateBetterCount) exceeding the margin — a deterministic,
  //      point-observation fact about THIS run, needing no statistical bound
  //      to be believed, exactly like the false-PASS screening gate's own
  //      "deterministic count comparison, no test" mechanism.
  //   3. Otherwise, an insufficient power assessment yields UNDERPOWERED.
  //   4. A PASS requires the clause to clear AND sufficient power.
  if (clause.gatingAxis.observedItemDelta > marginItems) {
    return { ...common, outcome: 'FAIL', power: clause.power, licence: licences.fail.text };
  }
  if (!clause.power.sufficient) {
    return { ...common, outcome: 'UNDERPOWERED', power: clause.power, licence: licences.underpowered.text };
  }
  return { ...common, outcome: 'PASS', power: clause.power, licence: licences.pass.text };
}

/** Serialises a verdict to pretty-printed JSON — the shape a maintainer commits or diffs. */
export function serialiseVerdict(verdict: GenerateFixVerdict): string {
  return JSON.stringify(verdict, null, 2);
}

/** Thrown by `parseVerdict` when the parsed JSON is not an object at the top level. */
export class InvalidVerdictJsonError extends Error {
  constructor(public readonly detail: string) {
    super(`Invalid verdict JSON: ${detail}`);
    this.name = 'InvalidVerdictJsonError';
  }
}

/**
 * Thrown by `parseVerdict` when a document claims `outcome: 'PASS'` but
 * carries an insufficient power assessment. The type system's D-85-6
 * guarantee (PASS's power field narrowed to `SufficientPower` alone) holds
 * inside this package's SOURCE — it does not survive serialisation, and a
 * verdict artifact is exactly the thing a later phase reads back off disk.
 * This is the second code path this repository's own standing lesson
 * warns about: a second path must re-prove the invariants the first one
 * enforced, not merely trust that whatever produced the JSON already did.
 */
export class VerdictPassPowerContradictionError extends Error {
  constructor() {
    super(
      "A verdict claims outcome 'PASS' but carries an insufficient power assessment — refusing to parse a self-contradictory verdict",
    );
    this.name = 'VerdictPassPowerContradictionError';
  }
}

/**
 * The ONLY supported path for reading a verdict back from JSON. Re-checks,
 * at runtime, the same invariant `GenerateFixVerdict`'s discriminated union
 * enforces at compile time: a `PASS` outcome's power field must be the
 * sufficient shape. A well-formed document round-trips unchanged.
 */
export function parseVerdict(json: string): GenerateFixVerdict {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidVerdictJsonError('top-level value is not an object');
  }
  const record = parsed as Record<string, unknown>;
  const power = record['power'];
  const sufficient =
    power !== null && typeof power === 'object' && (power as Record<string, unknown>)['sufficient'];
  if (record['outcome'] === 'PASS' && sufficient !== true) {
    throw new VerdictPassPowerContradictionError();
  }
  return parsed as GenerateFixVerdict;
}
