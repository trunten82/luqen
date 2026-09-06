/**
 * `verdict-comparability.ts` — a verdict's OWN partition of `RunFunction`'s
 * fields, distinct from `run-manifest.ts`'s `assertComparable` (HARNESS-04).
 *
 * 85-RESEARCH.md's Pitfall 5 recommends calling `assertComparable` here.
 * THAT IS WRONG. `assertComparable` compares `modelId` (among thirteen
 * fields) and refuses when it differs — but a baseline-versus-candidate
 * verdict comparison differs on `modelId` BY CONSTRUCTION (that is the whole
 * point of comparing two models). Calling `assertComparable` here would
 * refuse EVERY real use of this module.
 *
 * This module answers a DIFFERENT question than `run-manifest.ts` does.
 * Phase 84's question is "is this the same experiment run twice" (every
 * field but timestamp must match — used for Phase 86's run-to-run variance
 * measurement, where the run function must be IDENTICAL across repeats).
 * THIS module's question is "is this the same experiment with one thing
 * changed" — the treatment. So `RunFunction`'s fields split into three
 * groups instead of `assertComparable`'s two:
 *
 *   - CONSTANT: what the experiment must hold fixed for the comparison to
 *     mean anything (harness version, capability, mode, temperature, prompt
 *     version/source, set name/version/item count).
 *   - VARIED (the treatment): what the experiment deliberately changes
 *     (model id, model display name, provider type, endpoint fingerprint).
 *   - IGNORED: `timestamp`, for the same reason `assertComparable` ignores
 *     it — it differs on every run by construction.
 *
 * This is a deliberate SECOND predicate over the same field set, not a
 * duplicated one: it exists because Phase 84's predicate cannot answer this
 * phase's question, and it is guarded the same way `run-manifest.ts:246-277`
 * guards its own field classification — a compile-time exhaustiveness
 * assertion that fails to compile if a `RunFunction` key is left
 * unclassified. See run-manifest.ts's own recorded note about an earlier,
 * INERT version of that guard before "simplifying" this one.
 */
import { isFailedItem, isScoredItem, type ItemRecord } from './report.js';
import type { RunFunction } from './run-manifest.js';
import type { GenerateFixScoreRecord } from './score-generate-fix.js';
import type { TreatmentFieldsDiffered } from './verdict-types.js';

// ---------------------------------------------------------------------------
// The partition
// ---------------------------------------------------------------------------

/** Fields the experiment must hold CONSTANT for a baseline/candidate comparison to be meaningful. */
const CONSTANT_FIELDS = [
  'harnessVersion',
  'capability',
  'mode',
  'temperature',
  'promptVersion',
  'promptSource',
  'setName',
  'setVersion',
  'itemCount',
] as const satisfies readonly (keyof RunFunction)[];

/** Fields the experiment deliberately VARIES — the treatment. */
const VARIED_FIELDS = [
  'modelId',
  'modelDisplayName',
  'providerType',
  'endpointFingerprint',
] as const satisfies readonly (keyof RunFunction)[];

/** Fields ignored entirely — differs on every run by construction. */
const IGNORED_FIELDS = ['timestamp'] as const satisfies readonly (keyof RunFunction)[];

/**
 * COMPILE-TIME EXHAUSTIVENESS GUARD, mirroring run-manifest.ts:246-277.
 *
 * `satisfies readonly (keyof RunFunction)[]` on each list above proves every
 * LISTED field is a real key. It does NOT prove the reverse — that every key
 * is listed. Adding a 15th field to `RunFunction` and forgetting to classify
 * it here would leave it silently unchecked by `assertHoldsInvariantFields`,
 * and two runs differing only in that field would compare as "the same
 * experiment" when they are not.
 *
 * To BREAK IT (do this, do not trust it): add `readonly foo: string` to
 * `RunFunction` in run-manifest.ts without touching any list above, then run
 * `npx tsc --noEmit -p tsconfig.json`. It must fail here. See
 * run-manifest.ts's OWN note: an earlier attempt at exactly this guard used
 * `const x: UnclassifiedRunFunctionField[] = []`, which is INERT — an empty
 * array satisfies both `never[]` and `'foo'[]`, so it can never fail. Do not
 * "simplify" this back to that form.
 */
type UnclassifiedVerdictComparabilityField = Exclude<
  keyof RunFunction,
  (typeof CONSTANT_FIELDS)[number] | (typeof VARIED_FIELDS)[number] | (typeof IGNORED_FIELDS)[number]
>;
type AssertNever<T extends never> = T;
export type _EveryRunFunctionFieldIsClassifiedForComparability = AssertNever<UnclassifiedVerdictComparabilityField>;

// ---------------------------------------------------------------------------
// The invariant-field refusal
// ---------------------------------------------------------------------------

/**
 * Thrown by `assertHoldsInvariantFields` when the baseline and candidate
 * runs differ on a field the experiment must hold constant. Carries every
 * differing field name, following the named-error-subclass pattern
 * established by Phase 83 (`src/eval/types.ts`) and Phase 84
 * (`RunFunctionMismatchError`, run-manifest.ts).
 */
export class VerdictInvariantFieldMismatchError extends Error {
  constructor(public readonly differingFields: readonly string[]) {
    super(
      `Baseline and candidate runs differ on fields the experiment must hold constant: ${differingFields.join(', ')} — refusing to compute a verdict`,
    );
    this.name = 'VerdictInvariantFieldMismatchError';
  }
}

/**
 * Refuses a baseline/candidate comparison whose runs differ on any CONSTANT
 * field. Deliberately does NOT check the VARIED (treatment) fields — a pair
 * differing only on those must be accepted, since that is exactly what a
 * verdict is for.
 */
export function assertHoldsInvariantFields(baseline: RunFunction, candidate: RunFunction): void {
  const differing = CONSTANT_FIELDS.filter((field) => baseline[field] !== candidate[field]);
  if (differing.length > 0) {
    throw new VerdictInvariantFieldMismatchError(differing);
  }
}

/** Records, as data, which treatment fields actually differed between the two runs (see verdict-types.ts's doc comment on `TreatmentFieldsDiffered`). */
export function treatmentFieldsThatDiffered(
  baseline: RunFunction,
  candidate: RunFunction,
): TreatmentFieldsDiffered {
  return {
    modelId: baseline.modelId !== candidate.modelId,
    modelDisplayName: baseline.modelDisplayName !== candidate.modelDisplayName,
    providerType: baseline.providerType !== candidate.providerType,
    endpointFingerprint: baseline.endpointFingerprint !== candidate.endpointFingerprint,
  };
}

// ---------------------------------------------------------------------------
// Task 3 refusals — closing the paths a verdict can be reached through that
// the Task 1 tracer did not travel. Every refusal is a named error subclass
// carrying both sides' values, following Phase 83/84's convention. Nothing
// in this module catches a failure and returns a default.
// ---------------------------------------------------------------------------

/**
 * Thrown when either report contains a `FailedItemRecord`. A bar registered
 * against a fixed n cannot be applied to a run that scored fewer items than
 * that — a failed item and a bad score are different facts, and silently
 * treating a failure as "not counted" would let a partial run pass as a
 * complete one.
 */
export class FailedItemInReportError extends Error {
  constructor(
    public readonly side: 'baseline' | 'candidate',
    public readonly itemId: string,
  ) {
    super(
      `The ${side} report contains a failed item "${itemId}" — refusing to compute a verdict against an incomplete run`,
    );
    this.name = 'FailedItemInReportError';
  }
}

/** Refuses a comparison in which either report contains a failed item, naming the item and which side. */
export function assertNoFailedItems<TScore>(
  baselineItems: readonly ItemRecord<TScore>[],
  candidateItems: readonly ItemRecord<TScore>[],
): void {
  const failedBaseline = baselineItems.find(isFailedItem);
  if (failedBaseline !== undefined) {
    throw new FailedItemInReportError('baseline', failedBaseline.itemId);
  }
  const failedCandidate = candidateItems.find(isFailedItem);
  if (failedCandidate !== undefined) {
    throw new FailedItemInReportError('candidate', failedCandidate.itemId);
  }
}

/**
 * Thrown when the baseline and candidate reports do not carry the identical
 * set of item ids. Carries the ids present on only one side, sorted for a
 * deterministic message.
 */
export class ItemIdSetMismatchError extends Error {
  constructor(
    public readonly onlyInBaseline: readonly string[],
    public readonly onlyInCandidate: readonly string[],
  ) {
    super(
      `Baseline and candidate reports do not carry the identical set of item ids — only in baseline: [${onlyInBaseline.join(', ')}], only in candidate: [${onlyInCandidate.join(', ')}]`,
    );
    this.name = 'ItemIdSetMismatchError';
  }
}

/** Refuses a comparison whose two reports' item id sets differ, naming the difference. */
export function assertIdenticalItemIdSets<TScore>(
  baselineItems: readonly ItemRecord<TScore>[],
  candidateItems: readonly ItemRecord<TScore>[],
): void {
  const baselineIds = new Set(baselineItems.map((item) => item.itemId));
  const candidateIds = new Set(candidateItems.map((item) => item.itemId));
  const onlyInBaseline = [...baselineIds].filter((id) => !candidateIds.has(id)).sort();
  const onlyInCandidate = [...candidateIds].filter((id) => !baselineIds.has(id)).sort();
  if (onlyInBaseline.length > 0 || onlyInCandidate.length > 0) {
    throw new ItemIdSetMismatchError(onlyInBaseline, onlyInCandidate);
  }
}

/**
 * Thrown when a report's `aggregate.exactMatchCount` disagrees with a
 * recount of its own per-item scored records. A report is a JSON file a
 * person can edit — this is the cheapest guard in the phase and the one
 * most likely to matter: a verdict computed from an aggregate that no
 * longer describes the items beneath it would be confidently wrong.
 */
export class AggregateRecountMismatchError extends Error {
  constructor(
    public readonly side: 'baseline' | 'candidate',
    public readonly counterName: string,
    public readonly aggregateValue: number,
    public readonly recountedValue: number,
  ) {
    super(
      `The ${side} report's aggregate.${counterName} (${aggregateValue}) disagrees with a recount of its own per-item records (${recountedValue}) — refusing to judge a report whose aggregate no longer describes its own items`,
    );
    this.name = 'AggregateRecountMismatchError';
  }
}

/** Refuses a report whose gating-axis aggregate counter disagrees with a fresh recount of its own scored items. */
export function assertAggregateMatchesRecount(
  side: 'baseline' | 'candidate',
  items: readonly ItemRecord<GenerateFixScoreRecord>[],
  aggregateExactMatchCount: number,
): void {
  const recounted = items.filter((item) => isScoredItem(item) && item.score.exactMatch).length;
  if (recounted !== aggregateExactMatchCount) {
    throw new AggregateRecountMismatchError(side, 'exactMatchCount', aggregateExactMatchCount, recounted);
  }
}
