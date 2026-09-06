/**
 * `verdict-types.ts` — the Phase 85 verdict shape (D-85-6, BARS-03).
 *
 * Every field on every type below is REQUIRED. There is no `?` anywhere in
 * this module — the same discipline `RunFunction` (run-manifest.ts) and the
 * decision-bars loader (decision-bars.ts) already carry, and the defence
 * against 85-RESEARCH.md's Pitfall 2 (a required field quietly decaying into
 * "optional but always populated in practice").
 *
 * The one field whose value genuinely does not exist yet — Phase 86's
 * run-to-run score instability (D-85-5, a DIFFERENT quantity from the
 * discordance assumption below) — is modelled as a required field carrying
 * an explicit `'not-yet-measured'` state, never as an absent field.
 *
 * THE CENTRAL DESIGN DECISION (D-85-6): a PASS verdict's `power` field is
 * narrowed to `SufficientPower` alone — not `PowerAssessment` (the full
 * union). This makes it a COMPILE-TIME error to construct a `PassVerdict`
 * literal whose `power` field carries an `InsufficientPower` shape. FAIL
 * accepts either shape (an observed regression beyond the margin is an
 * observation and does not need power to be believed). UNDERPOWERED accepts
 * only the insufficient shape. See verdict.test.ts for the compiler-refusal
 * exercise that proves this narrowing is load-bearing, not decorative.
 */
import type { RunFunction } from './run-manifest.js';

// ---------------------------------------------------------------------------
// Power assessment
// ---------------------------------------------------------------------------

/**
 * The exact wording REQUIRED (coordinator ruling, 2026-09-06) on every
 * surface that renders the run-to-run instability ceiling below — verbatim,
 * never a paraphrase, so no reader concludes a real instability bar was
 * pre-registered when none was. Exported so `describeInsufficiencyReason`
 * (verdict.ts) and `buildLicenceQualifier` (licence-qualifier.ts) both quote
 * this SAME string rather than each writing their own approximation of it.
 */
export const RUN_TO_RUN_INSTABILITY_CEILING_NOTE =
  "This ceiling is a REUSE of a differently-named quantity's number, adopted because it can only tighten — NOT a pre-registered instability threshold. If a future milestone wants a real instability bar, it pre-registers one; this is a conservative stand-in until then.";

/**
 * THREE INDEPENDENT reasons a power assessment can be insufficient (D-85-5,
 * Phase 86 BASELINE-02/SC4/SC5). All three are checked independently and ANY
 * subset can appear together in one insufficient assessment's `reasons` list
 * — they are not mutually exclusive.
 */
export type PowerInsufficiencyReason =
  | {
      /** The observed McNemar discordant-pair rate exceeded the pre-registered assumption this margin's achieved power was derived from. */
      readonly kind: 'discordance-exceeds-assumption';
      readonly assumedDiscordantPairRate: number;
      readonly observedDiscordantPairRate: number;
    }
  | {
      /** The one-sided Clopper-Pearson upper bound on the baseline-better rate did not clear the margin proportion. */
      readonly kind: 'bound-does-not-clear-margin';
      readonly upperBound: number;
      readonly marginProportion: number;
    }
  | {
      /**
       * Phase 86 BASELINE-02: the measured run-to-run score instability — a
       * DIFFERENT quantity from the discordant-pair rate above (D-85-5,
       * 85-RESEARCH.md Open Question 1); it measures the SAME model/prompt
       * run repeated, not baseline-vs-candidate disagreement — exceeded the
       * pre-registered discordant-pair-rate assumption, REUSED here as a
       * ceiling.
       *
       * WHY REUSE THAT NUMBER (a judgement, not a derivation): the
       * pre-registered sample size was chosen under an assumption that
       * budgets 0.25 total disagreement between the two runs being
       * compared. If the instrument's own noise floor — the same
       * model/prompt disagreeing with itself — already exceeds that entire
       * budget, then the pre-registered `n` cannot detect the margin,
       * whatever the discordance turns out to be.
       *
       * DIRECTION, which is what licenses the reuse without a new
       * pre-registration: this check can only ever ADD an insufficiency
       * reason and never remove one, so it can only make a verdict MORE
       * conservative. A correction that STRENGTHENS a bar needs no
       * re-consent; one that WEAKENS it does. This sits on the safe side of
       * that line.
       *
       * {@link RUN_TO_RUN_INSTABILITY_CEILING_NOTE} — REQUIRED WORDING,
       * ruled by the coordinator 2026-09-06, reproduced on every rendering
       * surface: this ceiling is a REUSE of a differently-named quantity's
       * number, adopted because it can only tighten — NOT a pre-registered
       * instability threshold. No separate instability threshold was
       * pre-registered, because Phase 85 correctly declined to invent a
       * number for a quantity nobody had measured, and inventing one now —
       * after this phase exists to produce the first measurement — would be
       * exactly the fitting the milestone forbids.
       *
       * `observedRunToRunInstability` / `assumedCeiling` are DISTINCT field
       * names from `observedDiscordantPairRate` / `assumedDiscordantPairRate`
       * above — never reused, never overloaded, so a reader can tell which
       * of the two quantities moved.
       */
      readonly kind: 'run-to-run-instability-exceeds-ceiling';
      readonly observedRunToRunInstability: number;
      readonly assumedCeiling: number;
    };

/**
 * Phase 86's BASELINE-02 run-to-run score instability — a DIFFERENT quantity
 * from the discordant-pair rate above (D-85-5, 85-RESEARCH.md Open Question
 * 1). It measures the SAME model/prompt run repeated (non-determinism at
 * fixed temperature), not baseline-vs-candidate disagreement. Modelled as a
 * required field carrying an explicit not-yet-measured state so a reader
 * never has to guess whether the absence of a number means "zero" or
 * "unmeasured".
 */
export type RunToRunInstability =
  | { readonly state: 'not-yet-measured' }
  | { readonly state: 'measured'; readonly value: number };

/** The power field's SUFFICIENT shape — the only shape a PASS verdict may carry. */
export interface SufficientPower {
  readonly sufficient: true;
  readonly assumedDiscordantPairRate: number;
  readonly observedDiscordantPairRate: number;
  readonly runToRunInstability: RunToRunInstability;
}

/**
 * The power field's INSUFFICIENT shape. `reasons` is a non-empty tuple —
 * TypeScript's tuple-with-rest-element form is used (never a bare
 * `readonly string[]`) so an empty-reasons "insufficient" assessment cannot
 * even be constructed at the type level.
 */
export interface InsufficientPower {
  readonly sufficient: false;
  readonly reasons: readonly [PowerInsufficiencyReason, ...PowerInsufficiencyReason[]];
  readonly assumedDiscordantPairRate: number;
  readonly observedDiscordantPairRate: number;
  readonly runToRunInstability: RunToRunInstability;
}

export type PowerAssessment = SufficientPower | InsufficientPower;

// ---------------------------------------------------------------------------
// Gating axis / non-gating context
// ---------------------------------------------------------------------------

/**
 * The gating-axis clause result. `observedItemDelta` is `baselineBetterCount
 * - candidateBetterCount` (the McNemar "net" quantity) — the raw, observed,
 * point-estimate regression this run showed, independent of any statistical
 * bound. `upperBound`/`certifies` are the STATISTICAL result: the exact
 * one-sided 95% Clopper-Pearson upper bound on the baseline-better rate
 * alone (A-1) — a function of `baselineBetterCount` and `n` only, NEVER of
 * `candidateBetterCount` (the invariance A-8 requires).
 */
export interface GatingAxisReport {
  readonly counterName: string;
  readonly baselineBetterCount: number;
  readonly candidateBetterCount: number;
  readonly discordantPairCount: number;
  readonly observedItemDelta: number;
  readonly marginItems: number;
  readonly upperBound: number;
  readonly marginProportion: number;
  readonly certifies: boolean;
}

/** One of the five non-gating `generate-fix` axes, reported as context, never gating (D-85-2). */
export interface NonGatingAxisDelta {
  readonly counterName: string;
  readonly baselineMinusCandidate: number;
}

/** Which `RunFunction` treatment fields (verdict-comparability.ts) actually differed between the two runs. */
export interface TreatmentFieldsDiffered {
  readonly modelId: boolean;
  readonly modelDisplayName: boolean;
  readonly providerType: boolean;
  readonly endpointFingerprint: boolean;
}

// ---------------------------------------------------------------------------
// The verdict itself — a discriminated union on outcome (D-85-6)
// ---------------------------------------------------------------------------

export type VerdictOutcome = 'PASS' | 'FAIL' | 'UNDERPOWERED';

interface GenerateFixVerdictCommon {
  readonly capability: 'generate-fix';
  readonly baselineRunFunction: RunFunction;
  readonly candidateRunFunction: RunFunction;
  readonly gatingAxis: GatingAxisReport;
  readonly nonGatingAxisDeltas: readonly NonGatingAxisDelta[];
  readonly treatmentFieldsDiffered: TreatmentFieldsDiffered;
  readonly decisionBarsVersion: string;
  readonly decisionBarsDigestSha256: string;
  readonly licence: string;
}

export interface GenerateFixPassVerdict extends GenerateFixVerdictCommon {
  readonly outcome: 'PASS';
  /** Narrowed to SufficientPower alone — this is D-85-6, enforced structurally. */
  readonly power: SufficientPower;
}

export interface GenerateFixFailVerdict extends GenerateFixVerdictCommon {
  readonly outcome: 'FAIL';
  /** Either shape — an observed regression beyond the margin does not need power to be believed. */
  readonly power: PowerAssessment;
}

export interface GenerateFixUnderpoweredVerdict extends GenerateFixVerdictCommon {
  readonly outcome: 'UNDERPOWERED';
  /** Narrowed to InsufficientPower alone. */
  readonly power: InsufficientPower;
}

export type GenerateFixVerdict =
  | GenerateFixPassVerdict
  | GenerateFixFailVerdict
  | GenerateFixUnderpoweredVerdict;
