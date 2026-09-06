/**
 * `instability.ts` — BASELINE-02: run-to-run instability, computed and
 * named, not yet judged.
 *
 * DEFINITION, in OBSERVED terms, checkable by hand: given K repeat reports
 * of one IDENTICAL run function, for each unordered pair of repeats count
 * the items on which the two repeats DISAGREE on the capability's gating
 * boolean, divide by n (the shared item count), and report the MAXIMUM of
 * those pairwise rates as the run-to-run instability. The mean is carried
 * beside it as context, never as the gating value.
 *
 * WHY THE MAXIMUM, NOT THE MEAN: every decision rule in this milestone errs
 * toward alarm (85-CONTEXT.md A-1). The maximum pairwise disagreement rate
 * is the conservative reading of a noise floor — it reports how bad the
 * worst-observed pair of repeats looked, not how bad repeats look on
 * average. A candidate whose instability is judged against a mean would let
 * one unusually stable pair of repeats mask an unusually unstable one.
 *
 * THIS IS D-85-5's SECOND QUANTITY, named separately here so a reader never
 * has to guess which one a number refers to:
 *   - the McNemar DISCORDANT-PAIR RATE (verdict-types.ts
 *     `PowerInsufficiencyReason.discordance-exceeds-assumption`) measures
 *     BASELINE-vs-CANDIDATE disagreement — two DIFFERENT experiments run
 *     once each.
 *   - RUN-TO-RUN INSTABILITY (this module) measures the SAME model/prompt
 *     run REPEATED — one experiment's own non-determinism at fixed
 *     temperature, with no baseline/candidate distinction at all.
 * They are never the same number, and this module never compares one
 * against the other — that comparison is 86-02's job, deliberately, so the
 * quantity is defined and named before it is judged.
 *
 * PURE MODULE: no db, no adapter, no clock, no network, no file reads. It
 * takes already-parsed reports and computes over them.
 *
 * ONE ARITHMETIC PATH SERVING BOTH CAPABILITIES (not two): the two named
 * wrappers below both delegate to `computeRunToRunInstability`, differing
 * only in which score field they read as the gating boolean. This milestone
 * has already shipped four defects of the shape "an invariant proven on the
 * path someone was looking at, silently absent from its sibling"
 * (85-VERIFICATION.md); two independent implementations here would be the
 * fifth.
 */
import { assertComparable } from './run-manifest.js';
import { assertIdenticalItemIdSets, assertNoFailedItems } from './verdict-comparability.js';
import { scoresByItemId } from './verdict.js';
import type { HarnessReport } from './report.js';
import type { GenerateFixReport, AnalyseVisualReport } from './report.js';
import type { GenerateFixScoreRecord } from './score-generate-fix.js';
import type { AnalyseVisualScoreRecord } from './score-analyse-visual.js';
import type { RunToRunInstability } from './verdict-types.js';

/**
 * Thrown by `computeRunToRunInstability` when fewer than two repeat reports
 * are supplied. A single report has no pair to disagree with itself, so no
 * instability can be computed — never silently returned as zero.
 */
export class TooFewRepeatReportsError extends Error {
  constructor(public readonly count: number) {
    super(`computeRunToRunInstability requires at least 2 repeat reports to compute a pairwise rate, got ${count}`);
    this.name = 'TooFewRepeatReportsError';
  }
}

/**
 * One unordered pair's disagreement rate, carrying the two repeat indices it
 * came from — never just a bare number in an array, so a reader can trace
 * any rate back to the exact pair of repeats that produced it.
 */
export interface PairwiseInstabilityRate {
  readonly repeatIndexA: number;
  readonly repeatIndexB: number;
  readonly disagreementCount: number;
  readonly rate: number;
}

/**
 * The full run-to-run instability computation, every field required — no
 * `?` anywhere, the same discipline `RunFunction` and `verdict-types.ts`
 * already carry (85-RESEARCH.md Pitfall 2).
 */
export interface RunToRunInstabilityRecord {
  readonly modelId: string;
  readonly setName: string;
  readonly setVersion: string;
  readonly itemCount: number;
  readonly repeatCount: number;
  /** Every repeat's `RunFunction.timestamp`, in the order the reports were supplied. */
  readonly repeatTimestamps: readonly string[];
  /** Each repeat's count of items whose gating boolean was `true`, in the same order as `repeatTimestamps`. */
  readonly gatingCountByRepeat: readonly number[];
  /** Every unordered pair's disagreement rate — never only the maximum and mean, always the full set beneath them. */
  readonly pairwiseRates: readonly PairwiseInstabilityRate[];
  /** The GATING value (A-1's "err toward alarm") — the maximum pairwise disagreement rate. */
  readonly maximum: number;
  /** Context beside the gating value, never fused with it (HARNESS-03's "gating value beside its context" discipline). */
  readonly mean: number;
  readonly runToRunInstability: RunToRunInstability;
}

/**
 * Computes run-to-run instability over K (>= 2) repeat reports of one
 * IDENTICAL run function. `gatingBooleanOf` maps one score record to the
 * capability's gating boolean (`exactMatch` for `generate-fix`,
 * `verdictOutcome === 'correct'` for `analyse-visual`) — see the two named
 * wrappers below, which are the only intended call sites for real report
 * data; this function is exported so a future capability can supply its own
 * gating predicate without a second implementation.
 *
 * Refuses, in order:
 *   - fewer than two reports (`TooFewRepeatReportsError`);
 *   - any pair of run functions not accepted by `assertComparable` — the
 *     EXISTING `run-manifest.ts` refusal, not re-derived here. A variance
 *     measured across two DIFFERENT experiments is not a variance;
 *   - any report containing a `FailedItemRecord`, or the K reports not
 *     carrying an identical item-id set — both reused from
 *     `verdict-comparability.ts` (called pairwise against the first report,
 *     which is sufficient: identical-item-id-set is transitive, so if every
 *     other repeat matches the first, every repeat matches every other).
 */
export function computeRunToRunInstability<TScore>(
  reports: readonly HarnessReport<TScore, unknown>[],
  gatingBooleanOf: (score: TScore) => boolean,
): RunToRunInstabilityRecord {
  if (reports.length < 2) {
    throw new TooFewRepeatReportsError(reports.length);
  }

  const first = reports[0]!;
  for (let i = 1; i < reports.length; i++) {
    const repeat = reports[i]!;
    // Refuses a run-function mismatch on anything but timestamp — computing
    // a variance across two different experiments is refused, not averaged.
    assertComparable(first.runFunction, repeat.runFunction);
    assertNoFailedItems(first.items, repeat.items);
    assertIdenticalItemIdSets(first.items, repeat.items);
  }

  const itemCount = first.runFunction.itemCount;

  // Per-repeat itemId -> gating boolean map, reusing `scoresByItemId`
  // (verdict.ts) rather than re-deriving the per-item reading.
  const gatingByItemIdPerRepeat = reports.map((report) => {
    const scores = scoresByItemId(report.items);
    const gatingByItemId = new Map<string, boolean>();
    for (const [itemId, score] of scores) {
      gatingByItemId.set(itemId, gatingBooleanOf(score));
    }
    return gatingByItemId;
  });

  const gatingCountByRepeat = gatingByItemIdPerRepeat.map((gatingByItemId) => {
    let count = 0;
    for (const gating of gatingByItemId.values()) {
      if (gating) count += 1;
    }
    return count;
  });

  const pairwiseRates: PairwiseInstabilityRate[] = [];
  for (let i = 0; i < reports.length; i++) {
    for (let j = i + 1; j < reports.length; j++) {
      const mapA = gatingByItemIdPerRepeat[i]!;
      const mapB = gatingByItemIdPerRepeat[j]!;
      let disagreementCount = 0;
      for (const [itemId, gatingA] of mapA) {
        // The refusals above already guarantee identical item-id sets, so
        // every id in mapA has a counterpart in mapB by construction.
        const gatingB = mapB.get(itemId);
        if (gatingA !== gatingB) disagreementCount += 1;
      }
      pairwiseRates.push({
        repeatIndexA: i,
        repeatIndexB: j,
        disagreementCount,
        rate: disagreementCount / itemCount,
      });
    }
  }

  const rates = pairwiseRates.map((pair) => pair.rate);
  const maximum = Math.max(...rates);
  const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;

  return Object.freeze({
    modelId: first.runFunction.modelId,
    setName: first.runFunction.setName,
    setVersion: first.runFunction.setVersion,
    itemCount,
    repeatCount: reports.length,
    repeatTimestamps: reports.map((report) => report.runFunction.timestamp),
    gatingCountByRepeat,
    pairwiseRates,
    maximum,
    mean,
    runToRunInstability: { state: 'measured' as const, value: maximum },
  });
}

/** `generate-fix`'s gating boolean is `exactMatch` (D-85-2's own gating axis). */
export function runToRunInstabilityForGenerateFix(
  reports: readonly GenerateFixReport[],
): RunToRunInstabilityRecord {
  return computeRunToRunInstability<GenerateFixScoreRecord>(reports, (score) => score.exactMatch);
}

/** `analyse-visual`'s gating boolean is `verdictOutcome === 'correct'` (A-3's clause axis). */
export function runToRunInstabilityForAnalyseVisual(
  reports: readonly AnalyseVisualReport[],
): RunToRunInstabilityRecord {
  return computeRunToRunInstability<AnalyseVisualScoreRecord>(
    reports,
    (score) => score.verdictOutcome === 'correct',
  );
}
