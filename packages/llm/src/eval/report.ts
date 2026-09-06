/**
 * `report.ts` — the harness's persisted output shape (Phase 84, HARNESS-01/
 * HARNESS-02/HARNESS-04/HARNESS-06).
 *
 * A report carries the `RunFunction` that produced it (HARNESS-04), the
 * per-item records — not only the aggregate, so Phase 86's run-to-run
 * variance measurement can diff two of these files item by item — and an
 * aggregate computed only over items that produced a result. A per-item
 * capability failure is its own labelled outcome, never a silently-scored
 * zero: `failedCount` is reported separately from the aggregate.
 *
 * Items are sorted by id (`sortItemsById`) so two runs of the same
 * `RunFunction` serialise to identical JSON apart from `runFunction.
 * timestamp` — an unstable ordering would turn every downstream diff into
 * noise.
 *
 * This module carries NO bar, NO threshold, NO pass/fail verdict and NO
 * blended number for either capability — see the Phase 85 seam comment at
 * the bottom of this file.
 */
import type { RunFunction } from './run-manifest.js';
import type { GenerateFixScoreRecord } from './score-generate-fix.js';
import type { AnalyseVisualScoreRecord } from './score-analyse-visual.js';
import type { GenerateFixAggregate, AnalyseVisualAggregate } from './aggregate.js';
import type { RawResponseDiagnosis } from './diagnose-raw-response.js';

/** Bumped when this module's report SHAPE changes (independent of `RunFunction.harnessVersion`, which tracks scoring semantics). */
export const REPORT_SCHEMA_VERSION = '1';

/**
 * A per-item record for an item that produced a result. `rawText` and
 * `diagnosis` (HARNESS-06) travel beside the parsed `score` so a maintainer
 * reading a scored item sees the raw response, the parsed score, and
 * whether the model actually asserted the verdict it appears to have given.
 */
export interface ScoredItemRecord<TScore> {
  readonly itemId: string;
  readonly outcome: 'scored';
  readonly rawText: string | undefined;
  readonly diagnosis: RawResponseDiagnosis;
  readonly score: TScore;
}

/**
 * A per-item record for an item whose capability call failed (an exhausted
 * model, a missing fixture). This is its own labelled outcome — never a
 * zero-scoring item — because a failure and a bad answer are different
 * facts, and folding them together is the same category of error as fusing
 * false-PASS with false-ISSUE.
 */
export interface FailedItemRecord {
  readonly itemId: string;
  readonly outcome: 'failed';
  readonly failureReason: string;
}

export type ItemRecord<TScore> = ScoredItemRecord<TScore> | FailedItemRecord;

export function isScoredItem<TScore>(
  item: ItemRecord<TScore>,
): item is ScoredItemRecord<TScore> {
  return item.outcome === 'scored';
}

export function isFailedItem<TScore>(
  item: ItemRecord<TScore>,
): item is FailedItemRecord {
  return item.outcome === 'failed';
}

/**
 * Sorts a run's per-item records by id so two runs of the same run function
 * serialise to identical JSON apart from `runFunction.timestamp`.
 */
export function sortItemsById<TScore>(
  items: readonly ItemRecord<TScore>[],
): readonly ItemRecord<TScore>[] {
  return [...items].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

export interface HarnessReport<TScore, TAggregate> {
  readonly reportSchemaVersion: string;
  readonly runFunction: RunFunction;
  readonly items: readonly ItemRecord<TScore>[];
  readonly aggregate: TAggregate;
  /** Count of items whose capability call failed — reported SEPARATELY from the aggregate, never folded into it. */
  readonly failedCount: number;
}

export type GenerateFixReport = HarnessReport<GenerateFixScoreRecord, GenerateFixAggregate>;
export type AnalyseVisualReport = HarnessReport<AnalyseVisualScoreRecord, AnalyseVisualAggregate>;

/** Serialises a report to pretty-printed JSON — the shape a maintainer commits or diffs. */
export function serialiseReport<TScore, TAggregate>(
  report: HarnessReport<TScore, TAggregate>,
): string {
  return JSON.stringify(report, null, 2);
}

// ---------------------------------------------------------------------------
// Phase 85 seam — read before extending this module
// ---------------------------------------------------------------------------
//
// Phase 85 (pre-registered decision bars) adds a VERDICT object that CARRIES
// this report's RunFunction, plus a REQUIRED "power" field: the bar, the
// measured value, the variance ASSUMPTION the sample size was chosen from,
// and the observed variance. Phase 85 must NOT need to change:
//   - this report's existing shape (reportSchemaVersion, runFunction, items, aggregate, failedCount)
//   - the aggregate's counters (GenerateFixAggregate / AnalyseVisualAggregate)
//   - the absence of any judgement anywhere in this module
// Phase 84 measures; Phase 85 judges. Do not add a bar, margin, threshold,
// or verdict to this module.
