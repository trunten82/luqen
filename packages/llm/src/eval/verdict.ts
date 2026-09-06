/**
 * `verdict.ts` — the `generate-fix` non-inferiority comparator (85-02,
 * BARS-01/BARS-03).
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
import { assertHoldsInvariantFields, treatmentFieldsThatDiffered } from './verdict-comparability.js';
import { computeDifferenceUpperBound } from './power.js';
import type {
  GatingAxisReport,
  GenerateFixVerdict,
  PowerAssessment,
  PowerInsufficiencyReason,
  RunToRunInstability,
} from './verdict-types.js';

/** The five `generate-fix` axes reported as context, never gating (D-85-2, bar file `capabilityBars.generate-fix.nonGatingAxes`). */
const NON_GATING_COUNTER_NAMES = [
  'unchangedFromInputCount',
  'emptyFixCount',
  'missingMentionsCount',
  'effortMatchCount',
  'filenameShapedAltCount',
] as const satisfies readonly (keyof GenerateFixAggregate)[];

function scoresByItemId(
  items: readonly ItemRecord<GenerateFixScoreRecord>[],
): Map<string, GenerateFixScoreRecord> {
  const map = new Map<string, GenerateFixScoreRecord>();
  for (const item of items) {
    if (isScoredItem(item)) map.set(item.itemId, item.score);
  }
  return map;
}

/**
 * Computes the `generate-fix` non-inferiority verdict for a baseline/
 * candidate report pair against a loaded decision bar.
 *
 * Item pairing is deliberately item-by-item (never derived from the two
 * aggregates' delta): a candidate that fixes k items and breaks k others
 * shows an aggregate delta of zero but a discordance of 2k, and those are
 * different facts about how much this instrument can see.
 */
export function compareGenerateFix(
  bar: LoadedDecisionBars,
  baseline: GenerateFixReport,
  candidate: GenerateFixReport,
): GenerateFixVerdict {
  assertBarAppliesTo(bar, baseline.runFunction);
  assertBarAppliesTo(bar, candidate.runFunction);
  assertHoldsInvariantFields(baseline.runFunction, candidate.runFunction);

  const capabilityBar = bar.capabilityBars['generate-fix'];
  const n = capabilityBar.n;
  const marginItems = capabilityBar.nonInferiorityMargin.marginItems;
  const gatingCounterName = capabilityBar.gatingAxis.counterName;
  const assumedDiscordantPairRate = bar.varianceAssumption['generate-fix'].assumedValue;

  const baselineScores = scoresByItemId(baseline.items);
  const candidateScores = scoresByItemId(candidate.items);

  // Per-item pairing on the gating axis (exactMatch). A missing counterpart
  // on either side is a refusal Task 3 checks BEFORE this function is
  // reached (verdict-comparability.ts's item-id-set refusal); this loop
  // simply skips an unpaired id defensively rather than crashing.
  let baselineBetterCount = 0;
  let candidateBetterCount = 0;
  for (const [itemId, baselineScore] of baselineScores) {
    const candidateScore = candidateScores.get(itemId);
    if (candidateScore === undefined) continue;
    const baselineGood = baselineScore.exactMatch;
    const candidateGood = candidateScore.exactMatch;
    if (baselineGood && !candidateGood) baselineBetterCount += 1;
    if (candidateGood && !baselineGood) candidateBetterCount += 1;
  }

  const discordantPairCount = baselineBetterCount + candidateBetterCount;
  const observedItemDelta = baselineBetterCount - candidateBetterCount;
  const observedDiscordantPairRate = discordantPairCount / n;

  const bound = computeDifferenceUpperBound(baselineBetterCount, n, marginItems);

  // Two INDEPENDENT insufficiency reasons (D-85-5). Both are checked and
  // both may appear together — they are not mutually exclusive.
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

  const runToRunInstability: RunToRunInstability = { state: 'not-yet-measured' };
  const powerAssessment: PowerAssessment =
    reasons.length > 0
      ? {
          sufficient: false,
          reasons: [reasons[0]!, ...reasons.slice(1)],
          assumedDiscordantPairRate,
          observedDiscordantPairRate,
          runToRunInstability,
        }
      : { sufficient: true, assumedDiscordantPairRate, observedDiscordantPairRate, runToRunInstability };

  const gatingAxis: GatingAxisReport = {
    counterName: gatingCounterName,
    baselineBetterCount,
    candidateBetterCount,
    discordantPairCount,
    observedItemDelta,
    marginItems,
    upperBound: bound.upperBound,
    marginProportion: bound.marginProportion,
    certifies: bound.certifies,
  };

  const nonGatingAxisDeltas = NON_GATING_COUNTER_NAMES.map((counterName) => ({
    counterName,
    baselineMinusCandidate: baseline.aggregate[counterName] - candidate.aggregate[counterName],
  }));

  const treatmentFieldsDiffered = treatmentFieldsThatDiffered(baseline.runFunction, candidate.runFunction);

  const common = {
    capability: 'generate-fix' as const,
    baselineRunFunction: baseline.runFunction,
    candidateRunFunction: candidate.runFunction,
    gatingAxis,
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
  if (observedItemDelta > marginItems) {
    return { ...common, outcome: 'FAIL', power: powerAssessment, licence: licences.fail.text };
  }
  if (!powerAssessment.sufficient) {
    return { ...common, outcome: 'UNDERPOWERED', power: powerAssessment, licence: licences.underpowered.text };
  }
  return { ...common, outcome: 'PASS', power: powerAssessment, licence: licences.pass.text };
}

/** Serialises a verdict to pretty-printed JSON — the shape a maintainer commits or diffs. */
export function serialiseVerdict(verdict: GenerateFixVerdict): string {
  return JSON.stringify(verdict, null, 2);
}
