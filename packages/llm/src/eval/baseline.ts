/**
 * `baseline.ts` — BASELINE-01/02: the committable replication artifact, its
 * required sample-size assumption check, and the structural refusal that a
 * replay run is not a baseline (Phase 86 Task 3, ROADMAP SC2/SC3/SC4).
 *
 * A REPLAY RUN IS NOT A BASELINE. A fixture adapter returns the same string
 * every time, so a replay replication's run-to-run instability is exactly
 * zero BY CONSTRUCTION — a number that measures the determinism of the
 * fixture adapter, never of a model, and reads exactly like a good result if
 * nothing beside it says otherwise. This module is arranged so that number
 * can never be committed under a name that implies it measured a model:
 *
 *   - the artifact is a DISCRIMINATED UNION, not a flag on one shape. The
 *     production shape carries `mode: 'live'` (a literal type) and a
 *     top-level `runFunction` — the artifact's own identity. The synthetic
 *     shape carries `_synthetic: true` and a `syntheticNote`, in the exact
 *     envelope convention `verdict-analyse-visual.ts`'s committed fixtures
 *     already use, and deliberately carries NO top-level `runFunction` — the
 *     per-repeat run functions stay nested under `repeats`, where nothing can
 *     mistake them for the artifact's own identity.
 *   - there is NO exported path from the synthetic shape to the production
 *     one, at the type level.
 *   - the production WRITER (`serialiseLiveBaselineReplicationArtifact`)
 *     re-asserts `runFunction.mode === 'live'` at RUNTIME, because the type
 *     does not survive a JSON boundary and this artifact is exactly the kind
 *     of thing a later phase reads back off disk.
 *
 * PURE MODULE: no db, no adapter, no network, no file reads other than the
 * ones its callers pass in (already-parsed `HarnessReport`s and a
 * `LoadedDecisionBars`).
 *
 * The required `sampleSizeAssumptionCheck` field's boolean is computed by
 * IMPORTING `assessPower` (86-02, `verdict.ts`) rather than writing a second
 * `value > ceiling` comparison here — see `buildSampleSizeAssumptionCheck`'s
 * own doc comment for how the reuse is done without re-deriving the
 * predicate. Two implementations of one decision rule is the defect family
 * this milestone has shipped four times; this module refuses to be the
 * fifth.
 */
import { computeRunToRunInstability } from './instability.js';
import { assessPower } from './verdict.js';
import { RUN_TO_RUN_INSTABILITY_CEILING_NOTE } from './verdict-types.js';
import type { DifferenceUpperBoundResult } from './power.js';
import type { LoadedDecisionBars } from './decision-bars.js';
import type { RunFunction } from './run-manifest.js';
import type { HarnessReport, GenerateFixReport, AnalyseVisualReport } from './report.js';
import type { GenerateFixScoreRecord } from './score-generate-fix.js';
import type { AnalyseVisualScoreRecord } from './score-analyse-visual.js';
import type { RunToRunInstabilityRecord } from './instability.js';
import type { RunToRunInstability } from './verdict-types.js';

// ---------------------------------------------------------------------------
// The required sample-size assumption check (ROADMAP SC4)
// ---------------------------------------------------------------------------

/**
 * REQUIRED on both artifact shapes — no `?` anywhere in this module, the same
 * discipline `RunFunction` and `verdict-types.ts` already carry. Every field
 * is named DISTINCTLY from its counterparts on `PowerInsufficiencyReason`
 * (verdict-types.ts) so a reader never has to guess which of several
 * similarly-shaped numbers a field refers to.
 */
export interface SampleSizeAssumptionCheck {
  /** The measured quantity — run-to-run instability, NEVER the McNemar discordant-pair rate (D-85-5). */
  readonly observedRunToRunInstability: number;
  /** The pre-registered assumption this measurement was checked against — REUSED, not a new pre-registration (see {@link RUN_TO_RUN_INSTABILITY_CEILING_NOTE}). */
  readonly assumedDiscordantPairRateCeiling: number;
  /** Whether the assumption survives — computed by IMPORTING `assessPower` (86-02), never a second comparison. */
  readonly assumptionSurvives: boolean;
  /**
   * States, in one place: which quantity was measured; that the pre-registered
   * margin and `n` are UNCHANGED by this result; that a non-surviving
   * assumption makes results UNDERPOWERED and never relaxes the bar; and the
   * REQUIRED coordinator wording on what the ceiling is (a reuse, not a new
   * pre-registration) — reproduced verbatim via
   * {@link RUN_TO_RUN_INSTABILITY_CEILING_NOTE}, never a paraphrase.
   */
  readonly consequence: string;
}

/**
 * Computes `SampleSizeAssumptionCheck`'s `assumptionSurvives` boolean and
 * `consequence` sentence.
 *
 * THE REUSE, NOT A SECOND COMPARISON: `assessPower` (verdict.ts, 86-02)
 * already encodes the exact `runToRunInstability.value > assumedCeiling`
 * predicate as its third insufficiency reason. This function calls
 * `assessPower` with an `observedDiscordantPairRate` of 0 (which can never
 * exceed a non-negative `assumedDiscordantPairRate`, so the FIRST reason
 * never fires) and a `bound` that always certifies (so the SECOND reason
 * never fires) — the only way the returned assessment can come back
 * insufficient is via the THIRD reason, the one this check needs. This is
 * IMPORTING the predicate 86-02 added, not re-deriving it: the exact
 * `value > assumedCeiling` comparison this function needs is the one
 * `assessPower` already runs internally; this wrapper never repeats it.
 */
function buildSampleSizeAssumptionCheck(
  runToRunInstability: RunToRunInstability,
  assumedDiscordantPairRate: number,
): SampleSizeAssumptionCheck {
  const neverExceedingObservedDiscordantPairRate = 0;
  const alwaysCertifyingBound: DifferenceUpperBoundResult = {
    upperBound: 0,
    marginProportion: 1,
    certifies: true,
  };
  const assessment = assessPower(
    neverExceedingObservedDiscordantPairRate,
    assumedDiscordantPairRate,
    alwaysCertifyingBound,
    runToRunInstability,
  );

  // `computeRunToRunInstability` (instability.ts) always returns a `measured`
  // state -- a K>=2 pairwise computation always yields a real number. The
  // `0` fallback below is unreachable in practice; it exists only so this
  // field is always a real number, never `undefined`.
  const observedRunToRunInstability =
    runToRunInstability.state === 'measured' ? runToRunInstability.value : 0;

  const assumptionSurvives = assessment.sufficient;

  const consequence = assumptionSurvives
    ? `Measured quantity: run-to-run instability (NEVER the McNemar discordant-pair rate, D-85-5) -- observed ${observedRunToRunInstability} against the reused ceiling ${assumedDiscordantPairRate}; the assumption SURVIVES. The pre-registered margin and sample size n are UNCHANGED by this result. ${RUN_TO_RUN_INSTABILITY_CEILING_NOTE}`
    : `Measured quantity: run-to-run instability (NEVER the McNemar discordant-pair rate, D-85-5) -- observed ${observedRunToRunInstability} exceeded the reused ceiling ${assumedDiscordantPairRate}; the assumption DOES NOT SURVIVE. The pre-registered margin and sample size n are UNCHANGED by this result -- any comparison against this baseline is UNDERPOWERED for this reason, and the bar is NEVER relaxed. ${RUN_TO_RUN_INSTABILITY_CEILING_NOTE}`;

  return {
    observedRunToRunInstability,
    assumedDiscordantPairRateCeiling: assumedDiscordantPairRate,
    assumptionSurvives,
    consequence,
  };
}

// ---------------------------------------------------------------------------
// The replication artifact — a discriminated union, not a flag on one shape
// ---------------------------------------------------------------------------

/**
 * Fields common to both shapes. `instability` embeds the WHOLE
 * `RunToRunInstabilityRecord` (instability.ts) — repeat count, every
 * repeat's timestamp, each repeat's gating count, every pairwise rate, the
 * gating maximum and context mean, and the `RunToRunInstability` value
 * itself — REUSED wholesale rather than re-listing its fields here a second
 * time. `repeats` carries each repeat's own `RunFunction`, nested, so it can
 * never be mistaken for the artifact's own top-level identity (which only
 * the production shape carries, as `runFunction`).
 */
interface BaselineReplicationArtifactCommon {
  readonly instability: RunToRunInstabilityRecord;
  readonly repeats: readonly RunFunction[];
  readonly sampleSizeAssumptionCheck: SampleSizeAssumptionCheck;
}

/**
 * THE PRODUCTION SHAPE. Carries a top-level `runFunction` — the artifact's
 * own identity, and the thing a future reader checks to confirm this is a
 * baseline of PRODUCTION pins, not a replay. `mode: 'live'` is a literal
 * type, not a plain `RunMode` — this is what makes handing a
 * `SyntheticBaselineReplicationArtifact` to a function typed to accept only
 * this shape a COMPILE error.
 */
export interface LiveBaselineReplicationArtifact extends BaselineReplicationArtifactCommon {
  readonly mode: 'live';
  readonly runFunction: RunFunction;
}

/**
 * THE SYNTHETIC/REPLAY SHAPE. Carries `_synthetic: true` and a
 * `syntheticNote`, in the exact envelope convention Phases 84 and 85's
 * committed verdict fixtures already use — and, deliberately, NO top-level
 * `runFunction`. A replay run's own determinism (a fixture adapter returning
 * the same string every time) makes its measured instability exactly zero
 * BY CONSTRUCTION; `syntheticNote` states that fact so a reader of this
 * artifact directly (not only of a CLI's printed summary) cannot mistake a
 * meaningless zero for a measured stability result.
 */
export interface SyntheticBaselineReplicationArtifact extends BaselineReplicationArtifactCommon {
  readonly _synthetic: true;
  readonly syntheticNote: string;
}

export type BaselineReplicationArtifact =
  | LiveBaselineReplicationArtifact
  | SyntheticBaselineReplicationArtifact;

/** Narrows the union — `'mode' in artifact` is present ONLY on the production shape. */
export function isLiveBaselineReplicationArtifact(
  artifact: BaselineReplicationArtifact,
): artifact is LiveBaselineReplicationArtifact {
  return 'mode' in artifact && artifact.mode === 'live';
}

const SYNTHETIC_BASELINE_NOTE =
  "Hand-written or replay-mode repeat reports -- NOT a live model call, and no measurement of a model exists as a result of building this artifact. This shape's run-to-run instability measures the determinism of whatever produced these repeats, never a model: a REAL replay run uses a deterministic fixture adapter, so its instability is 0 BY CONSTRUCTION -- a real replay replication of this shape necessarily carries `instability.maximum === 0` (any other value here means these repeats did not come from the real deterministic replay path, e.g. a hand-written test fixture). This artifact must never be read as a baseline of production pins.";

// ---------------------------------------------------------------------------
// The refusal: a production write attempted on a non-live run function
// ---------------------------------------------------------------------------

/**
 * Thrown by `serialiseLiveBaselineReplicationArtifact` when the artifact's
 * OWN `runFunction.mode` is not `'live'` -- e.g. an object literal that
 * claims the production shape (structurally: `mode: 'live'` plus a
 * top-level `runFunction`) while the nested `runFunction.mode` actually says
 * `'replay'`. TypeScript's `LiveBaselineReplicationArtifact` type does not
 * narrow `RunFunction['mode']` to the literal `'live'`, so this
 * self-contradiction compiles cleanly and must be caught at runtime instead
 * -- the exact "the type does not survive a JSON boundary" case this module
 * exists to close.
 */
export class BaselineArtifactRuntimeModeMismatchError extends Error {
  constructor(public readonly actualMode: string) {
    super(
      `Refusing to write a baseline replication artifact as production: claims 'live' mode but the embedded run function's mode is actually '${actualMode}' -- a replay run is not a baseline`,
    );
    this.name = 'BaselineArtifactRuntimeModeMismatchError';
  }
}

// ---------------------------------------------------------------------------
// The builder — one arithmetic path, two named capability wrappers
// ---------------------------------------------------------------------------

/**
 * Builds a `BaselineReplicationArtifact` from K (>= 2) repeat reports of one
 * IDENTICAL run function. Reuses `computeRunToRunInstability` (instability.ts,
 * 86-01) for the entire pairwise computation AND for its existing refusals:
 *
 *   - fewer than two repeats -> `TooFewRepeatReportsError` propagates, not
 *     re-wrapped;
 *   - mixed run functions across the repeats -- INCLUDING mixed `mode`,
 *     which is one of `assertComparable`'s (run-manifest.ts) compared
 *     fields -- -> `RunFunctionMismatchError` propagates, not re-wrapped.
 *     "Mixed modes across the repeats" is this SAME refusal, reused, not a
 *     second one;
 *   - a failed item, or non-identical item-id sets across repeats ->
 *     `FailedItemInReportError` / `ItemIdSetMismatchError` propagate.
 *
 * This function adds NO second comparison of its own for any of the above --
 * it calls `computeRunToRunInstability` and lets whatever it throws
 * propagate.
 */
function buildBaselineReplicationArtifact<TScore>(
  reports: readonly HarnessReport<TScore, unknown>[],
  gatingBooleanOf: (score: TScore) => boolean,
  capability: 'generate-fix' | 'analyse-visual',
  bar: LoadedDecisionBars,
): BaselineReplicationArtifact {
  const instability = computeRunToRunInstability(reports, gatingBooleanOf);

  const repeats = reports.map((report) => report.runFunction);
  const assumedDiscordantPairRate = bar.varianceAssumption[capability].assumedValue;
  const sampleSizeAssumptionCheck = buildSampleSizeAssumptionCheck(
    instability.runToRunInstability,
    assumedDiscordantPairRate,
  );

  const mode = reports[0]!.runFunction.mode;
  if (mode === 'live') {
    return {
      mode: 'live',
      runFunction: reports[0]!.runFunction,
      instability,
      repeats,
      sampleSizeAssumptionCheck,
    };
  }
  return {
    _synthetic: true,
    syntheticNote: SYNTHETIC_BASELINE_NOTE,
    instability,
    repeats,
    sampleSizeAssumptionCheck,
  };
}

/** `generate-fix`'s gating boolean is `exactMatch` (D-85-2, matches `instability.ts`'s own wrapper). */
export function buildGenerateFixBaselineReplicationArtifact(
  reports: readonly GenerateFixReport[],
  bar: LoadedDecisionBars,
): BaselineReplicationArtifact {
  return buildBaselineReplicationArtifact<GenerateFixScoreRecord>(
    reports,
    (score) => score.exactMatch,
    'generate-fix',
    bar,
  );
}

/** `analyse-visual`'s gating boolean is `verdictOutcome === 'correct'` (A-3, matches `instability.ts`'s own wrapper). */
export function buildAnalyseVisualBaselineReplicationArtifact(
  reports: readonly AnalyseVisualReport[],
  bar: LoadedDecisionBars,
): BaselineReplicationArtifact {
  return buildBaselineReplicationArtifact<AnalyseVisualScoreRecord>(
    reports,
    (score) => score.verdictOutcome === 'correct',
    'analyse-visual',
    bar,
  );
}

// ---------------------------------------------------------------------------
// The writers — two, each accepting only its own shape
// ---------------------------------------------------------------------------

/**
 * THE PRODUCTION WRITER. Accepts only `LiveBaselineReplicationArtifact` at
 * the type level -- handing it a `SyntheticBaselineReplicationArtifact` is a
 * COMPILE error. Re-asserts `runFunction.mode === 'live'` at RUNTIME because
 * the type does not survive a JSON boundary: an object literal built (or
 * hand-edited) to structurally match this shape while its embedded
 * `runFunction.mode` actually says `'replay'` compiles cleanly and must be
 * caught here instead.
 */
export function serialiseLiveBaselineReplicationArtifact(
  artifact: LiveBaselineReplicationArtifact,
): string {
  if (artifact.runFunction.mode !== 'live') {
    throw new BaselineArtifactRuntimeModeMismatchError(artifact.runFunction.mode);
  }
  return JSON.stringify(artifact, null, 2);
}

/** THE SYNTHETIC/REPLAY WRITER. Accepts only `SyntheticBaselineReplicationArtifact` -- no mode re-assertion needed, since this shape never claims production identity. */
export function serialiseSyntheticBaselineReplicationArtifact(
  artifact: SyntheticBaselineReplicationArtifact,
): string {
  return JSON.stringify(artifact, null, 2);
}

/**
 * Convenience dispatcher for a caller holding the UNION type (e.g. the CLI,
 * which receives whichever shape the builder returned and does not know in
 * advance which one). Delegates to the shape-specific writer above -- this
 * does NOT weaken the "compile error" guarantee those two writers carry
 * individually, since a caller who already knows which shape they hold
 * should still call the specific writer directly.
 */
export function serialiseBaselineReplicationArtifact(artifact: BaselineReplicationArtifact): string {
  return isLiveBaselineReplicationArtifact(artifact)
    ? serialiseLiveBaselineReplicationArtifact(artifact)
    : serialiseSyntheticBaselineReplicationArtifact(artifact as SyntheticBaselineReplicationArtifact);
}
